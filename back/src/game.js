import { is_answer_valid, is_answer_accepted, compare_answers } from "ptitbac-commons";
import { log_info } from "./logging.js";

export class Game {
  constructor(slug, server) {
    // The duration of the countdowns before a round.
    this.ROUND_COUNTDOWN = 3;

    this.slug = slug;
    this.server = server;

    this.players = {};
    this.master_player_uuid = null;

    // Who can change the categories: "master" (game master only),
    // "everyone", or "proposals" (each player can add ONE category to the
    // list; the game master removes unwanted ones like any category).
    this.categories_mode = "master";

    // In "proposals" mode, tracks who proposed what, as category → uuid.
    // Used to enforce the one-proposal-per-player rule and to display
    // the proposer's name to everyone.
    this.category_owners = {};

    // If the duration is set to this value, then the round will only
    // stop when the first ends (if endMode is "first") or when
    // all players end (else).
    this.infinite_duration = 600;

    // Countdown duration used by the "timerAfterFirst" end mode when the
    // configured time is infinite (the UI prevents this combination, but
    // the server must not end up with an infinite countdown).
    this.default_after_first_duration = 60;

    this.configuration = {
      categories: [],
      // How rounds end: "first" (first player to finish interrupts
      // everyone), "timer" (global time limit only), or "timerAfterFirst"
      // (no limit until the first player finishes, then a countdown of
      // `time` seconds starts for everyone else).
      endMode: "first",
      turns: 4,
      time: this.infinite_duration,
      alphabet: "",
      scores: {
        // The answer is valid, accepted by the players, and is not duplicated.
        valid: 10,

        // Same as the above, but another player answered the same thing for this
        // category.
        duplicate: 5,

        // The answer is invalid (does not start with the good letter).
        invalid: 0,

        // The answer is valid, but was refused by the other players.
        refused: 0,

        // The answer is empty.
        empty: 0
      }
    };

    this.state = "CONFIG";
    this.locked = false;

    this.current_round = 0;
    this.current_letter = null;
    this.current_countdown_started = null;
    this.current_started = null;
    this.current_timeout = null;
    this.current_round_ends_at = null;
    this.current_round_interrupted_by = null;

    this.current_round_answers_final_received = [];
    this.current_round_votes_ready = [];

    this.rounds = {};
    this.final_scores = [];

    this.used_letters = [];

    this.pending_deletion_task = null;
    this.pending_deletion_threshold = 1000 * 60 * 20;

    this.just_created = true;
  }

  log(message) {
    log_info("[" + this.slug + "] " + message);
  }

  static clean_player_for_users(player) {
    return {
      uuid: player.uuid,
      pseudonym: player.pseudonym,
      ready: player.ready,
      master: player.master,
      online: player.online
    };
  }

  // Checks if all items in the first array are included in the
  // second target array. Returns `true` if so, `false` else.
  static first_included_into_second(array, target) {
    return target.every(value => array.includes(value));
  }

  /**
   * Sanitizes a client-provided categories list: strings only, trimmed,
   * bounded in length and count, deduplicated.
   */
  static clean_categories(categories) {
    return categories
      .filter(c => typeof c === "string" || typeof c === "number")
      .map(c => c.toString().trim())
      .filter((c, i, all) => c && c.length <= 128 && all.indexOf(c) === i)
      .slice(0, 50);
  }

  is_valid_player(uuid) {
    return !!this.players[uuid];
  }

  online_players() {
    return Object.values(this.players).filter(player => player.online);
  }

  online_players_uuids() {
    return this.online_players().map(player => player.uuid);
  }

  is_valid_category(category) {
    return this.configuration.categories.includes(category);
  }

  random_letter() {
    let letter = "";

    // For some reason, the alphabet is empty. To avoid an infinite loop,
    // let's return the 4th letter (4 was selected using a fair dice roll).
    if (this.configuration.alphabet.length === 0) {
      return "D";
    }

    // We reset the alphabet if all letters were drawn.
    if (this.used_letters.length === this.configuration.alphabet.length) {
      this.used_letters = [];
    }

    // An infinite loop here would hang the whole server for every players, so
    // we want extra securities.
    let draws = 0;
    while (!letter || (this.used_letters.indexOf(letter) !== -1 && draws < 64)) {
      letter = this.configuration.alphabet.charAt(Math.floor(Math.random() * this.configuration.alphabet.length));
      draws++;
    }

    this.used_letters.push(letter);
    return letter;
  }

  broadcast(action, message) {
    this.online_players().filter(player => player.connection !== null).forEach(player => this.server.send_message(player.connection, action, message));
  }

  send_message(uuid, action, message) {
    let player = this.players[uuid];
    if (!player || !player.online || !player.connection) return;

    return this.server.send_message(player.connection, action, message);
  }

  start_deletion_process() {
    this.pending_deletion_task = setTimeout(() => {
      this.log(`${this.pending_deletion_threshold / 1000} seconds without players: destroying game.`);
      this.server.delete_game(this.slug);
    }, this.pending_deletion_threshold);
  }

  halt_deletion_process() {
    if (this.pending_deletion_task) {
      clearTimeout(this.pending_deletion_task);
      this.pending_deletion_task = null;
    }
  }

  join(connection, uuid, pseudonym) {
    // This player is the master (can configure the game)
    // if it created the game, i.e. if it's the first player.
    let master_player = (this.online_players().length === 0) || this.master_player_uuid === uuid;

    // Is this a reconnection?
    let player = this.players[uuid];

    // Existing player
    if (player && !player.online) {
      player.online = true;
      player.connection = connection;
      player.pseudonym = pseudonym; // It may change.
      player.master = master_player; // If the player is the first to reconnect it will be master.
    }

    // New player
    else {
      // If the game is locked, we refuse the connection.
      if (this.locked) {
        this.kick(uuid, true, connection);
        return;
      }

      player = {
        connection: connection,
        uuid: uuid,
        pseudonym: pseudonym,
        ready: true,
        online: true,
        master: master_player
      };

      this.players[player.uuid] = player;

      this.server.increment_statistic("players");
    }

    if (master_player) {
      this.master_player_uuid = player.uuid;
    }

    this.broadcast("player-join", {player: Game.clean_player_for_users(player)});

    // We send to this new player all other players
    Object.keys(this.players).filter(uuid => uuid !== player.uuid).forEach(uuid => {
      this.server.send_message(connection, "player-join", {player: Game.clean_player_for_users(this.players[uuid])});
    });

    // And the current game configuration
    if (!this.just_created) this.send_message(uuid, "config-updated", { configuration: this.configuration });
    this.send_message(uuid, "game-locked", { locked: this.locked });

    if (this.categories_mode !== "master") {
      this.send_message(uuid, "categories-mode", { mode: this.categories_mode });
    }

    if (Object.keys(this.category_owners).length > 0) {
      this.send_message(uuid, "category-proposals", {
        proposals: Object.keys(this.category_owners).map(category => ({
          category,
          uuid: this.category_owners[category]
        }))
      });
    }

    // And the game state if we're not in CONFIG
    if (this.state !== "CONFIG") {
      this.catch_up(uuid);
    }

    this.log("Player " + player.pseudonym + " (" + player.uuid + ") joined the game (total: " + this.online_players().length + "/" + Object.keys(this.players).length + ").");

    this.halt_deletion_process();

    this.just_created = false;
  }

  left(uuid, forget) {
    let player = this.players[uuid];
    if (!player) return;

    if (this.state === "CONFIG" || forget) {
      delete this.players[uuid];
    }
    else {
      player.online = false;
      player.connection = null;
    }

    this.broadcast("player-left", {player: {
      uuid: player.uuid
    }});

    this.log("Player " + player.pseudonym + " (" + player.uuid + ") left the game (still online: " + this.online_players().length + "/" + Object.keys(this.players).length + ").");

    if (this.state === "ROUND_ANSWERS" || this.state === "ROUND_ANSWERS_FINAL") {
      this.check_for_round_end();
    }
    else if (this.state === "ROUND_VOTES") {
      this.check_for_vote_end();
    }

    if (this.online_players().length === 0) {
      this.start_deletion_process();
    }

    if (this.master_player_uuid === uuid) {
      this.elect_random_master();
    }
  }

  kick(uuid, locked, connection) {
    this.log("Kicking player " + uuid);

    if (!connection && (!uuid || !this.players[uuid])) return;

    return this.server.send_message(connection || this.players[uuid].connection, "kick", { locked }).then(() => {
      if (uuid) {
        let player = this.players[uuid];

        if (player) {
          // left() clears player.connection — keep a reference so we can
          // actually close it (a null connection used to crash the server).
          let player_connection = player.connection;
          this.left(uuid, this.locked);
          if (player_connection) player_connection.close();
        }
      }
    });
  }

  /**
   * When a client connects during the game, this method will send it the
   * current state of the game, so it can catch up.
   */
  catch_up(uuid) {
    if (this.state === "CONFIG") return;

    let catch_up = {
      state: this.state === "ROUND_ANSWERS_FINAL" ? "ROUND_ANSWERS" : this.state
    };

    switch (this.state) {
      case "ROUND_ANSWERS_COUNTDOWN":
        catch_up.countdown = Math.round((new Date().getTime() - this.current_countdown_started) / 1000);
        break;
      case "ROUND_ANSWERS":
      case "ROUND_ANSWERS_FINAL":
        catch_up.round = {
          round: this.current_round,
          letter: this.current_letter,
          time_left: this.current_round_ends_at !== null ? Math.max(Math.ceil((this.current_round_ends_at - Date.now()) / 1000), 0) : null,
          players_ready: Object.keys(this.rounds[this.current_round].answers)
        };
        break;

      case "ROUND_VOTES":
        catch_up.vote = {
          answers: this.rounds[this.current_round].votes,
          interrupted: this.current_round_interrupted_by,
          players_ready: this.current_round_votes_ready
        };
        break;

      case "END":
        catch_up.end = {
          scores: this.final_scores
        };
        break;
    }

    switch (this.state) {
      case "ROUND_ANSWERS_FINAL":
        this.current_round_answers_final_received.push(uuid);
        break;

      case "ROUND_VOTES":
        this.current_round_votes_ready.push(uuid);
        break;
    }

    this.send_message(uuid, "catch-up-game-state", catch_up);
  }

  update_configuration(uuid, configuration) {
    // We don't accept configuration update during the game.
    if (this.state !== "CONFIG") return;
    if (!this.is_valid_player(uuid)) return;

    let configuration_accepted = true;

    if (!Array.isArray(configuration.categories)) configuration_accepted = false;

    // If the configuration is updated by a non-master player,
    // we ignore it and send a configuration update with the current config
    // to erase client-side its changes.
    // In the "everyone" categories mode, we accept the change but only keep
    // categories from the configuration sent, discarding everything else.
    // In the "proposals" mode, we only accept adding/removing the player's
    // own single proposal.
    if (configuration_accepted && this.master_player_uuid !== uuid) {
      if (this.categories_mode === "everyone") {
        // We only keep the categories, using the existing configuration for everything else.
        configuration = {
          ...this.configuration,
          ...{ categories: configuration.categories }
        }
      } else if (this.categories_mode === "proposals") {
        let categories = this.apply_category_proposal(
          uuid,
          Game.clean_categories(configuration.categories)
        );

        if (categories === null) {
          configuration_accepted = false;
        } else {
          configuration = {
            ...this.configuration,
            ...{ categories }
          };
        }
      } else {
        configuration_accepted = false;
      }
    }

    if (configuration_accepted && (!configuration.scores || typeof configuration.scores !== "object")) configuration_accepted = false;

    if (!configuration_accepted) {
      this.send_message(uuid, "config-updated", {configuration: this.configuration});
      return;
    }

    let num_or_default = (n, def) => {
      n = parseInt(n);
      return isNaN(n) ? def : n;
    }

    // Else we update the internal configuration and send the update to everyone.
    // Everything client-provided is clamped: strings-only bounded categories,
    // turns and time within sane limits (a time above the infinite threshold
    // would overflow setTimeout and end rounds instantly).
    this.configuration = {
      categories: Game.clean_categories(configuration.categories),
      endMode: ["first", "timer", "timerAfterFirst"].includes(configuration.endMode) ? configuration.endMode : "first",
      turns: Math.min(Math.max(Math.abs(parseInt(configuration.turns) || 4), 1), 30),
      time: Math.min(Math.max(Math.abs(parseInt(configuration.time) || 400), 15), this.infinite_duration),
      alphabet: (typeof configuration.alphabet === "string" && configuration.alphabet.slice(0, 128)) || "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      scores: {
        valid: num_or_default(configuration.scores.valid, 10),
        duplicate: num_or_default(configuration.scores.duplicate, 5),
        invalid: num_or_default(configuration.scores.invalid, 0),
        refused: num_or_default(configuration.scores.refused, 0),
        empty: num_or_default(configuration.scores.empty, 0),
      }
    };

    // Proposals removed by the master are freed, so their author can
    // propose something else.
    if (this.categories_mode === "proposals") {
      this.sync_category_owners();
      this.broadcast_category_proposals();
    }

    this.broadcast("config-updated", {configuration: this.configuration});
  }

  set_categories_mode(uuid, mode) {
    if (!["master", "everyone", "proposals"].includes(mode)) return;

    // If the player is not master, we reject this change and send it a reverse message to reset
    // its client to the correct state.
    if (this.master_player_uuid !== uuid) {
      this.send_message(uuid, "categories-mode", { mode: this.categories_mode });
      return;
    }

    this.categories_mode = mode;
    this.broadcast("categories-mode", { mode });

    // Proposed categories stay in the configuration, but they are no
    // longer marked as proposals outside of the proposals mode.
    if (mode !== "proposals" && Object.keys(this.category_owners).length > 0) {
      this.category_owners = {};
      this.broadcast_category_proposals();
    }
  }

  broadcast_category_proposals() {
    this.broadcast("category-proposals", {
      proposals: Object.keys(this.category_owners).map(category => ({
        category,
        uuid: this.category_owners[category]
      }))
    });
  }

  /**
   * In "proposals" mode, a non-master player edits the categories through
   * the regular configuration update, but is only allowed to add a single
   * category of their own and to remove it. Returns the accepted categories
   * list, or null if the change is not acceptable.
   */
  apply_category_proposal(uuid, new_categories) {
    let current = this.configuration.categories;
    let added = new_categories.filter(c => !current.includes(c));
    let removed = current.filter(c => !new_categories.includes(c));

    // Only their own proposal can be removed.
    if (removed.some(c => this.category_owners[c] !== uuid)) return null;

    // At most one new category…
    if (added.length > 1) return null;

    if (added.length === 1) {
      // …and only if they don't already have a pending proposal (unless
      // they are replacing it in the same update).
      let own_proposals = Object.keys(this.category_owners)
        .filter(c => this.category_owners[c] === uuid && !removed.includes(c));
      if (own_proposals.length > 0) return null;
    }

    removed.forEach(c => delete this.category_owners[c]);
    added.forEach(c => this.category_owners[c] = uuid);

    return current.filter(c => !removed.includes(c)).concat(added);
  }

  // The master edits categories freely; proposals they remove are simply
  // dropped, so their author can propose something else.
  sync_category_owners() {
    Object.keys(this.category_owners).forEach(category => {
      if (!this.configuration.categories.includes(category)) {
        delete this.category_owners[category];
      }
    });
  }

  elect_random_master() {
    let online_uuids = this.online_players_uuids();
    if (online_uuids.length > 0) {
      this.elect_master(online_uuids[Math.floor(Math.random() * online_uuids.length)]);
    }
  }

  elect_master(new_master_uuid) {
    let old_master = this.players[this.master_player_uuid];
    let new_master = this.players[new_master_uuid];

    if (!new_master) return;

    if (old_master) {
      old_master.master = false;
    }

    new_master.master = true;
    this.master_player_uuid = new_master_uuid;

    this.broadcast("set-master", {
      master: {
        uuid: this.master_player_uuid
      }
    });
  }

  switch_master(uuid, new_master_uuid) {
    if (this.master_player_uuid !== uuid) return;
    this.elect_master(new_master_uuid);
  }

  set_lock(uuid, locked) {
    if (this.master_player_uuid !== uuid) return;
    this.locked = locked;
    this.broadcast("game-locked", { locked: this.locked });
  }

  kick_by_master(uuid, target_uuid) {
    if (this.master_player_uuid !== uuid) return;
    this.kick(target_uuid, false);
  }

  start(connection, uuid) {
    if (!this.is_valid_player(uuid)) return;
    if (this.master_player_uuid !== uuid) return; // Nope

    if (this.configuration.categories.length === 0) return;
    if (this.configuration.alphabet.length === 0) return;

    this.log("Starting game");

    // Once the game starts, proposed categories are part of the game:
    // they are not tracked anymore.
    this.category_owners = {};

    this.next_round();

    this.server.increment_statistic("games");
  }

  next_round() {
    this.state = "ROUND_ANSWERS_COUNTDOWN";
    this.current_countdown_started = new Date().getTime();
    this.broadcast("round-starts-soon", {
      countdown: this.ROUND_COUNTDOWN
    });

    this.server.increment_statistic("rounds");

    setTimeout(() => {
      this.state = "ROUND_ANSWERS";
      this.current_round++;
      this.current_letter = this.random_letter();

      this.current_round_interrupted_by = null;
      this.current_round_answers_final_received = [];
      this.current_round_votes_ready = [];

      this.rounds[this.current_round] = {
        letter: this.current_letter,
        answers: {},
        votes: {}
      };

      this.broadcast("round-started", {
        "round": this.current_round,
        "letter": this.current_letter
      });

      this.log(`Starting round #${this.current_round} with letter ${this.current_letter}.`);

      this.current_started = Date.now();

      // In "timerAfterFirst" mode, the countdown only starts when the
      // first player finishes (see receive_answers).
      if (this.configuration.endMode !== "timerAfterFirst" && this.configuration.time != this.infinite_duration) {
        this.arm_round_timeout(this.configuration.time);
      }
    }, this.ROUND_COUNTDOWN * 1000);
  }

  arm_round_timeout(duration) {
    this.clear_round_timeout();

    this.current_round_ends_at = Date.now() + duration * 1000;
    this.current_timeout = setTimeout(() => {
      this.end_round();
    }, duration * 1000);
  }

  clear_round_timeout() {
    if (this.current_timeout) {
      clearTimeout(this.current_timeout);
      this.current_timeout = null;
    }

    this.current_round_ends_at = null;
  }

  receive_answers(uuid, answers) {
    if (!this.is_valid_player(uuid)) return;
    if (this.state !== "ROUND_ANSWERS" && this.state !== "ROUND_ANSWERS_FINAL") return;

    let checked_answers = {};
    let all_valid = true;

    this.configuration.categories.forEach(category => {
      // Only plain strings are acceptable answers — anything else coming
      // from a forged client is treated as no answer (is_answer_valid
      // throws on non-strings, which used to crash the server).
      if (Object.prototype.hasOwnProperty.call(answers, category) && typeof answers[category] === "string") {
        let answer = answers[category].slice(0, 256);
        let valid = is_answer_valid(this.current_letter, answer);
        all_valid &= valid;

        checked_answers[category] = {
          answer: answer,
          valid: valid
        };
      }
      else {
        all_valid = false;
        checked_answers[category] = {
          answer: null,
          valid: false
        };
      }
    });

    this.rounds[this.current_round].answers[uuid] = checked_answers;

    if (this.state == "ROUND_ANSWERS") {
      this.broadcast("player-ready", {player: {uuid: uuid}});

      if (this.configuration.endMode === "first") {
        this.current_round_interrupted_by = uuid;
        this.end_round();
      }

      // First player to finish starts the countdown for everyone else.
      else if (this.configuration.endMode === "timerAfterFirst" && !this.current_timeout) {
        let duration = this.configuration.time != this.infinite_duration
          ? this.configuration.time
          : this.default_after_first_duration;

        this.arm_round_timeout(duration);
        this.broadcast("countdown-started", {duration});
      }
    }
    else {
      this.current_round_answers_final_received.push(uuid);
    }

    this.check_for_round_end();
  }

  check_for_round_end() {
    if (this.state !== "ROUND_ANSWERS" && this.state !== "ROUND_ANSWERS_FINAL") return;

    // Normal round answers time: we end the round if everyone answered.
    if (this.state == "ROUND_ANSWERS") {
      if (Game.first_included_into_second(Object.keys(this.rounds[this.current_round].answers), this.online_players_uuids())) {
        this.end_round();
      }
    }

    // Final round answer time: we have to collect the answers for every player.
    // We check for each answers if we have the whole serie; if so, we go to the
    // voting phase.
    else {
      if (Game.first_included_into_second(this.current_round_answers_final_received, this.online_players_uuids())) {
        this.start_vote();
      }
    }
  }

  end_round() {
    if (this.state !== "ROUND_ANSWERS") return;

    // The round may end before its timeout fires (first-completion or
    // everyone answered); without this, the stale timeout would end the
    // *next* round prematurely.
    this.clear_round_timeout();

    this.state = "ROUND_ANSWERS_FINAL";
    this.broadcast("round-ended", {});

    this.log(`Round #${this.current_round} ended. Collecting answers…`);

    // If there is no one logged in when the round ends, we start the vote.
    // If the players log in again, they'll have some kind of vote (sadly,
    // without all answers), and if not, the game will be cleaned up at
    // some point.
    if (this.online_players().length === 0) {
      this.start_vote();
    }
  }

  start_vote() {
    this.log(`Starting vote for round #${this.current_round}.`);

    // We assemble the votes by category, then send them to the clients.

    let votes = {};

    Object.keys(this.rounds[this.current_round].answers).forEach(uuid => {
      let answers = this.rounds[this.current_round].answers[uuid];

      Object.keys(answers).forEach(category => {
        if (!Object.prototype.hasOwnProperty.call(votes, category)) {
          votes[category] = {};
        }

        let answer = answers[category];
        let vote = {
          answer: answer.answer,
          valid: answer.valid,
          votes: {}
        };

        this.online_players_uuids().forEach(uuid => vote.votes[uuid] = answer.valid);

        votes[category][uuid] = vote;
      });
    });

    this.rounds[this.current_round].votes = votes;
    this.broadcast("vote-started", {answers: votes, interrupted: this.current_round_interrupted_by});

    this.state = "ROUND_VOTES";
  }

  receive_vote(uuid, category, author_uuid, vote) {
    if (this.state !== "ROUND_VOTES") return;
    if (!this.is_valid_player(uuid) || !this.is_valid_player(author_uuid) || !this.is_valid_category(category)) return;

    let author_answer = this.rounds[this.current_round].votes[category][author_uuid];

    // We don't want someone messing up with newly-joined players, with a valid
    // UUID but without vote entry. (Not possible with the standard client but
    // prevents abuses.)
    if (!author_answer) return;

    author_answer.votes[uuid] = !!vote;
    this.broadcast("vote-changed", {
      voter: {
          uuid: uuid
      },
      vote: {
          uuid: author_uuid,
          category: category,
          vote: !!vote
      }
    });
  }

  receive_vote_ready(uuid) {
    this.current_round_votes_ready.push(uuid);
    this.broadcast("player-ready", {player: {uuid: uuid}});
    this.check_for_vote_end();
  }

  check_for_vote_end() {
    if (Game.first_included_into_second(this.current_round_votes_ready, this.online_players_uuids())) {
      if (this.current_round === this.configuration.turns) {
        this.end_game();
      }
      else {
        this.next_round();
      }
    }
  }

  end_game() {
    if (this.state !== "ROUND_VOTES") return;

    this.log("Ending game…");

    // For each connected player, we count its scores
    Object.keys(this.players).forEach(uuid => {
      let score = 0;

      Object.keys(this.rounds).forEach(round => {
        this.configuration.categories.forEach(category => {
          if (!this.rounds[round].votes) return;

          let votes = this.rounds[round].votes[category];
          if (!votes) return;

          let player_votes = votes[uuid];

          if (!player_votes || !player_votes.answer) {
            score += this.configuration.scores.empty;
            return;
          }
          else if (!player_votes.valid) {
            score += this.configuration.scores.invalid;
            return;
          }
          else if (!is_answer_accepted(player_votes.votes)) {
            score += this.configuration.scores.refused;
            return;
          }

          // We check if the answer is unique.
          let unique = true;

          Object.keys(votes).forEach(other_answer_author_uuid => {
            // Don't compare with ourself.
            if (other_answer_author_uuid === uuid) return;

            let other_answer = votes[other_answer_author_uuid].answer;
            if (other_answer && compare_answers(player_votes.answer, other_answer)) {
              unique = false;
            }
          });

          if (unique) {
            score += this.configuration.scores.valid;
          }
          else {
            score += this.configuration.scores.duplicate;
          }
        });
      });

      this.final_scores.push({
        uuid: uuid,
        score: score
      });
    });

    this.final_scores.sort((a, b) => b.score - a.score);

    let rank = 1;
    this.final_scores.forEach((score, i) => {
      // We only increase the rank if the score is different.
      if (i > 0 && this.final_scores[i].score < this.final_scores[i - 1].score) {
        rank++;
      }

      this.final_scores[i].rank = rank;
    });

    this.broadcast("game-ended", {scores: this.final_scores});
    this.state = "END";
  }

  restart(uuid) {
    if (this.state !== "END") return;
    if (uuid !== this.master_player_uuid) return;

    this.state = "CONFIG";

    this.clear_round_timeout();

    this.current_round = 0;
    this.current_letter = null;
    this.current_started = null;
    this.current_round_interrupted_by = null;

    this.current_round_answers_final_received = [];
    this.current_round_votes_ready = [];

    this.rounds = {};
    this.final_scores = [];

    // We remove offline players. The client will do the same on its side.
    Object.values(this.players).filter(player => !player.online).map(player => player.uuid).forEach(uuid => {
      delete this.players[uuid];
    });

    this.broadcast("game-restarted", {});
  }
}
