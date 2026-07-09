# Client → Server

## Common fields

These are included in every message (except if specified), and will not be repeated afterwards.

```json
{
    "action": "action-name",
    "uuid": "the-user-assigned-uuid-or-null-to-get-one",
    "secret": "the-user-assigned-secret-or-null-to-get-one",
    "slug": "the-game-slug"
}
```

- If the `uuid` field is `null` or undefined, the server will send a `set-uuid` message.
- If the `secret` field is `null` or undefined or invalid, and the `uuid` field is set, the message will be rejected.

## `join-game`

The client asks to join a game.

```json
{
    "pseudonym": "The requested pseudonym"
}
```

If the `slug` is set, the server will add the player to this game if it exists; creating a new one else (either if the `slug` is `null` or unknown).

Will answer with `set-slug` to set the game slug (if the game exists, it will be the same slug as the one sent), and with one `player-join` for every player in the game (including the client that sent the message).

## `update-config`

The client updates the configuration of the game.

```json
{
    "configuration": {
        "categories": [
            "Category 1",
            "Category 2"
        ],
        "endMode": "first",
        "turns": 4,
        "time": 180
    }
}
```

`endMode` describes how rounds end:

- `first`: the first player to finish interrupts everyone (the `time` limit still applies);
- `timer`: the round only ends when the `time` limit is reached (or when everyone finished);
- `timerAfterFirst`: no time limit until the first player finishes; then a countdown of `time` seconds starts for everyone else (see `countdown-started`).

If the client is not master and the categories mode is `master`, or if the game's state is not `CONFIG`,
the update will be ignored and a `config-updated` message will be replied with the previous configuration to reset it.

Else, a `config-updated` message will be broadcasted to the players of the game (excluding the client that sent the message),
and the new configuration saved server-side.

If the sender is not master, non-categories changes are always discarded. In the `everyone` categories mode the
whole categories list is accepted; in the `proposals` mode only the sender's own single proposal may be added or
removed (see `change-categories-mode`).

## `lock-game`

Asks the server to (un)lock the game, preventing any new player to join. If the sender is not master, the message is ignored.

```json
{
  "locked": true
}
```

## `switch-master`

Asks the server to give master power to a specific player. If the sender is not master, the message is ignored.

```json
{
  "master": {
    "uuid": "the new master's UUID"
  }
}
```

## `kick-player`

Asks the server to kick a specific player. If the sender is not master, the message is ignored.

```json
{
  "kick": {
    "uuid": "the kicked player's UUID"
  }
}
```

## `change-categories-mode`

Changes who can edit the categories. If the sender is not master, the message is ignored and a `categories-mode`
message is replied with the current mode to reset the client.

```json
{
  "mode": "master | everyone | proposals"
}
```

- `master`: only the game master can edit categories (default);
- `everyone`: everyone can edit categories;
- `proposals`: each non-master player may add a single category of their own to the list, through the regular
  `update-config` message. The server only accepts, from a non-master player, the addition of one new category
  (if the player has no pending proposal) and/or the removal of their own proposal; any other change is rejected
  and the configuration is reset client-side. The game master removes unwanted proposals like any other category,
  which frees the author to propose something else.

Leaving the `proposals` mode keeps the proposed categories but stops tracking them as proposals.

## `start-game`

Starts the game.

```json
{}
```

The message will be ignored if the sender is not master.

## `send-answers`

In the active part of a round, sends answers for the current letter.

```json
{
    "answers": {
        "Category 1": "The answer",
        "Category 2": "The answer"
    }
}
```

If `endMode` is `first`, this will end the current round's active phase. If `endMode` is `timerAfterFirst` and no
countdown is running yet, this starts the end-of-round countdown (see `countdown-started`).

## `send-vote`

In the voting part of a round, sends a vote on one's answer. `true` to accept the answer; `false` to reject it.

```json
{
    "vote": {
        "uuid": "The UUID of the player who wrote the answer",
        "category": "The voted category",
        "vote": true
    }
}
```

## `vote-ready`

Indicates that the client votes are done and that we can go to the next round. When every logged-in client are ready, the next round starts automatically.

```json
{}
```

## `restart`

During the end screen, the client asks to restart the game.

```json
{}
```

The message will be ignored if the sender is not master, or if we're not in the `FINAL` game state.

# Server → Client

## Common fields

These are included in every message, and will not be repeated afterwards.

```json
{
    "action": "action-name"
}
```

## `set-server-runtime-identifier`

Sets an identifier that the client must save (only in the page memory, it should not persist over reloads). When the client is disconnected, when it reconnects, it should check the identifier sent and compare it with the one stored, and force-reload if they differ—this means the game server rebooted and the current game is lost.

It is also used when the player was idle in the tab out of a game for way too long, disconnected, and its server-side client reference was cleaned up.

```json
{
  "runtime_identifier": "a string identifier"
}
```

## `set-uuid`

Sets the client's UUID, and a secret for simple auth, to be sent in every subsequent message.

```json
{
    "uuid": "the-user-assigned-uuid",
    "secret": "a-secret-to-authenticate-users"
}
```

## `set-slug`

Sets the game's slug, to be sent in every subsequent message, and to be reflected into the URL / share box.

```json
{
    "slug": "the-game-slug"
}
```

## `kick`

Indicates that the player was kicked from the game. If `locked` is true, that's because the game was locked.

```json
{
    "locked": true
}
```

## `player-join`

Indicates that a player joined the game. Also used when a player joins the game to send it all other already-connected players.

```json
{
    "player": {
        "uuid": "8b42a578-5948-4237-8db0-cae73ff16699",
        "pseudonym": "The Pseudonym",
        "ready": true,
        "master": false
    }
}
```

## `player-left`

Indicates that a player left the game.

```json
{
    "player": {
        "uuid": "8b42a578-5948-4237-8db0-cae73ff16699"
    }
}
```

## `set-master`

Indicates that the master player has changed.

```json
{
  "master": {
    "uuid":"8b42a578-5948-4237-8db0-cae73ff16699"
  }
}
```

## `set-suggested-categories`

Sends suggested categories to the client. These are used for autocompletion in the configuration form.

```json
{
  "categories": [
    "Category 1",
    "Category 2"
  ]
}
```

## `config-updated`

Indicates that the game's config has changed.

```json
{
    "configuration": {
        "categories": [
            "Category 1",
            "Category 2"
        ],
        "endMode": "first",
        "turns": 4,
        "time": 180
    }
}
```

## `game-locked`

Indicates that the game's locked (or not).

```json
{
  "locked": true
}
```

## `categories-mode`

Indicates who can edit the categories (see `change-categories-mode`). This message is also sent to new players
joining the game, if the mode is not `master`.

```json
{
  "mode": "master | everyone | proposals"
}
```

## `category-proposals`

Broadcasts which of the configured categories are player proposals (in `proposals` categories mode), so clients
can display who proposed what. Sent every time the configuration changes in this mode, and to new players joining
the game if the list is not empty.

```json
{
  "proposals": [
    {
      "category": "The proposed category",
      "uuid": "the proposer's UUID"
    }
  ]
}
```

## `catch-up-game-state`

Sent when someone joins the game after its beginning. This message allows the client to sync up with the game.

```json
{
  "state": "ROUND_ANSWERS",
  "countdown": 2,
  "round": {
    "round": 1,
    "letter": "E",
    "time_left": 28,
    "players_ready": [
      "a-player-uuid",
      "a-player-uuid"
    ]
  },
  "vote": {
    "answers": {
      "the same structure": "as in `vote-started`"
    },
    "interrupted": "a-player-uuid-or-null",
    "players_ready": [
      "a-player-uuid",
      "a-player-uuid"
    ]
  },
  "end": {
    "scores": [
      "the same structure",
      "as in `game-ended`"
    ]
  }
}
```

The `CONFIG` state can be ignored as if someone logs out during config, it is removed.

Of this JSON message, only the `state` key and another relevant one is sent. The state can be:

- `ROUND_ANSWERS_COUNTDOWN`: the countdown before the beginning of a round (other key: `countdown`);
- `ROUND_ANSWERS`: the main part of a round, where players fill the answers (other key: `round`);
- `ROUND_VOTES`: the voting part of a round, where players vote for other answers (other key: `vote`);
- `END`: the end screen of the game (other key: `end`).

If the internal state is `ROUND_ANSWERS_FINAL`, we send `ROUND_ANSWERS` and consider that the final answers were sent (no time to fill them anyway).

`time_left` is in seconds, and will be `null` if no end-of-round countdown is currently running (infinite rounds,
or `timerAfterFirst` mode before the first player finished).

## `countdown-started`

In `timerAfterFirst` end mode, indicates that the first player finished and that the end-of-round countdown
started. The client should start a countdown of the given number of seconds.

```json
{
  "duration": 60
}
```

## `round-starts-soon`

Indicates that the round will start soon. The client shoud display a countdown with the given number of seconds.

```json
{
  "countdown": 3
}
```

## `round-started`

Indicates that a new round starts. It will end when a `round-ended` message is received.

When received, all players must be marked as non-ready.

```json
{
    "round": 1,
    "letter": "E"
}
```

## `player-ready`

Indicates that a player is ready.

```json
{
    "player": {
        "uuid": "the-user-assigned-uuid"
    }
}
```

## `round-ended`

Indicates that a round just ended.

When this message is received, the client must send its final submissions with `send-answers`, and display a loading screen until `vote-started` is received.

```json
{}
```

## `vote-started`

Indicates that the voting process starts.

```json
{
    "answers": {
        "Category 1": {
            "a-player-uuid": {
              "answer": "This player's answer",
              "valid": true,
              "votes": {
                  "a-player-uuid": true,
                  "a-player-uuid": true,
                  "a-player-uuid": true,
                  "a-player-uuid": true,
                  "a-player-uuid": true
              },
            }
        }
    },
    "interrupted": "a-player-uuid-or-null"
}
```

In the `answers` object, `answer` is the answer's text, and `votes` contains the initial votes for each player: all values will be `true` if the answer respects the basic rules of the game (i.e. starts with the correct letter, accents and such removed); `false` else.

If the game is set to be interrupted on first completion, `interrupted` will be set to the UUID of the interrupting player. Else, it will be set to `null`.

## `vote-changed`

Indicates that someone updated their vote.

```json
{
    "voter": {
        "uuid": "the-user-assigned-uuid"
    },
    "vote": {
        "uuid": "The UUID of the player who wrote the answer",
        "category": "Category 1",
        "vote": true
    }
}
```

## `game-ended`

Indicates that the game ended and that the client should display the final scores.

```json
{
    "scores": [
        {
            "uuid": "a-player-uuid",
            "score": 243,
            "rank": 1
        },
        {
            "uuid": "a-player-uuid",
            "score": 242,
            "rank": 2
        },
        {
            "uuid": "a-player-uuid",
            "score": 141,
            "rank": 3
        },
    ]
}
```

## `game-restarted`

Indicates that the game is restarted. The client will go back to the configuration screen.

```json
{}
```
