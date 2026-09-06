# Karaoke Combat

Karaoke Combat is a local multiplayer singing game. Two players use phones as microphones and compete on a host display. The host plays a YouTube backing track, shows the target melody and lyrics, and renders a fighting-game battle. A player's detected pitch is compared with the current MIDI note; successful singing earns score and contributes damage to the opponent.

## 1. Project Story

The project began as a hackathon prototype based on a browser host page, microphone clients, Socket.IO, Phaser-oriented fighting-game notes, and hand-authored song data. The current implementation evolved into a React and Vite application:

- React Router provides the landing page, host page, and player page.
- Express and Socket.IO provide the shared multiplayer session.
- The browser Web Audio API captures microphones and performs autocorrelation pitch detection.
- The host uses the YouTube IFrame API as the authoritative song clock.
- MIDI notes provide target pitch and timing.
- LRC lyrics provide timed lyric lines.
- React components render the battle arena, sprite fighters, and karaoke highway.
- Song packs combine a YouTube video, MIDI-derived notes, lyrics, duration, and a tunable sync offset.

The older design notes in `First draft/implementation_guide.md` describe the original vanilla JavaScript and Phaser plan. They are historical context; the running application is the React/Vite implementation described below.

## 2. Runtime Architecture

```text
Browser: Vite + React on :3000
  /                 Landing page
  /host             Host display and game authority
  /client?p=1       Player 1 microphone controller
  /client?p=2       Player 2 microphone controller

Node: Express + Socket.IO on :3001
  REST APIs         Song, MIDI, lyrics, and sync-offset data
  Socket.IO         Lobby, pitch, game start, state, and game-over events

External services
  YouTube           Backing video and playback clock
  LRCLIB            Optional lyrics search through the server proxy
  ngrok             Optional public HTTPS tunnel for mobile devices
```

In local development, Vite proxies `/api`, `/midi`, `/lyrics`, and `/socket.io` to the server. The client therefore normally uses the browser's current origin. When accessed through an ngrok hostname, Socket.IO also uses that same origin.

## 3. Technology Stack

- TypeScript
- React 19 and React DOM
- Vite
- React Router
- Express
- Socket.IO and Socket.IO client
- Web Audio API
- YouTube IFrame Player API
- `lucide-react` for interface icons
- `tsx` for running the TypeScript server
- `concurrently` and `cross-env` for development scripts
- ngrok for optional HTTPS/mobile access

## 4. Requirements

- Node.js 18 or newer
- npm 9 or newer
- A YouTube video with a usable backing track
- A MIDI file containing the target melody
- Timed LRC lyrics
- Two microphone-capable browsers for players
- For LAN play, all devices must be on the same network
- For phone microphone access over a network, use HTTPS through `npm run dev:lan` or ngrok

## 5. Installation and Running

Install dependencies:

```bash
npm install
```

### Standard development with ngrok

```bash
npm run dev
```

This concurrently starts the Express server, Vite, and the ngrok process. The ngrok helper prints the public URL and writes it to `ngrok-urls.json` and `public/ngrok-urls.json`.

### Localhost and LAN without ngrok

```bash
npm run dev:local
```

Use `http://localhost:3000/host` on the main display. For another device, replace `localhost` with the host computer's LAN IP:

```text
http://<host-ip>:3000/client?p=1
http://<host-ip>:3000/client?p=2
```

### LAN HTTPS

```bash
npm run dev:lan
```

This enables Vite's basic SSL plugin. The browser will usually require accepting the local certificate. HTTPS is needed because browsers restrict microphone access on ordinary HTTP origins.

### Build and preview

```bash
npm run build
npm run preview
```

`npm run build` builds the Vite frontend. The Express server is run separately and is not bundled by Vite.

## 6. Player Workflow

1. Open `/host` on the main display.
2. Open `/client?p=1` and `/client?p=2` on the two player devices.
3. Each player grants microphone permission and enables the microphone.
4. Each player presses Ready.
5. The host loads a song pack, or manually loads a YouTube video, MIDI file, and LRC lyrics.
6. The host starts the battle.
7. The song is divided into four equal segments. Player 1 attacks in segments 1 and 3; Player 2 attacks in segments 2 and 4.
8. The attacking player sings the current target note. The host updates score, combo, damage, lyrics, fighters, and the karaoke highway.
9. When the YouTube video ends, the higher score wins. If scores tie, average accuracy decides; otherwise the result is a tie.

A player can be assigned automatically, or can request a slot with the `p` query parameter. The server permits one host and two players per process-wide session.

## 7. Application Entry Points

- [index.tsx](index.tsx): Finds the `root` element and mounts the React application.
- [App.tsx](App.tsx): Defines routes and the landing page.
- [pages/HostPage.tsx](pages/HostPage.tsx): Loads assets, owns YouTube playback, runs the game loop, and displays the battle.
- [pages/ClientPage.tsx](pages/ClientPage.tsx): Requests the microphone, detects pitch, and sends player data.
- [components/SpriteFighter.tsx](components/SpriteFighter.tsx): Displays animated fighter sprites, health, score, and combo tier.
- [components/KaraokeHighway.tsx](components/KaraokeHighway.tsx): Displays target notes, playhead, and the player's pitch trail.

## 8. Server Responsibilities

[server/index.ts](server/index.ts) creates an Express HTTP server and attaches Socket.IO. It keeps one in-memory session containing host and player socket IDs, ready flags, the selected song, and game status.

The server:

- Assigns player slots 1 and 2.
- Prevents a second host and rejects a third player.
- Tracks ready state and notifies the host when both players are ready.
- Accepts a start request from the host and broadcasts the song configuration.
- Relays pitch data from players to the host.
- Relays host game-state snapshots to players.
- Broadcasts game-over events.
- Resets or ends the session when a participant disconnects.

The session is not persisted. Restarting the server clears all connections and game state.

## 9. Client and Host Data Flow

### Player pitch path

```text
Microphone
  -> MediaStream
  -> AudioContext + AnalyserNode
  -> RMS volume calculation
  -> autoCorrelate(buffer, sampleRate)
  -> pitch_data Socket.IO event
  -> server relay
  -> host pitch refs
```

The client samples audio with an animation-frame loop. It transmits valid pitch approximately every third frame, about 20 updates per second. Silence or a weak signal is represented by `-1` and is not transmitted.

### Host game path

```text
YouTube currentTime
  + MIDI notes
  + latest P1/P2 pitches
  -> processGameTick()
  -> GameState
  -> host UI
  -> game_state_update Socket.IO event
  -> player displays
```

The host reads YouTube time each animation frame. State snapshots are sent to players at most every 100 ms. Animation flags are reset after a short delay so fighter attacks and hit reactions can be retriggered.

## 10. Socket.IO Contract

Payload types are defined in [types.ts](types.ts). The main events are:

| Direction | Event | Purpose |
|---|---|---|
| Client -> server | `join` | Join as host or player, optionally requesting slot 1 or 2 |
| Server -> client | `player_assigned` | Announces the assigned player slot |
| Server -> all | `lobby_update` | Announces connection and ready state |
| Client -> server | `player_ready` | Marks an assigned player ready |
| Server -> host | `all_ready` | Both players are ready |
| Host -> server | `start_game` | Sends the selected `SongConfig` |
| Server -> all | `game_start` | Starts the game on every connected client |
| Player -> server | `pitch_data` | Sends slot, pitch, timestamp, and volume |
| Server -> host | `pitch_update` | Relays the latest player pitch |
| Host -> server | `game_state_update` | Sends the current authoritative game state |
| Server -> players | `game_state` | Updates player displays |
| Host -> server | `game_over` | Sends winner and final scores |
| Server -> all | `game_over` | Announces the end of the game |
| Server -> client | `error` | Reports join or permission failures |

## 11. Game Rules and Scoring

Game state and phases are defined in [types.ts](types.ts): `LOBBY`, `COUNTDOWN`, `PLAYING`, and `GAME_OVER`. The current flow transitions from lobby directly to playing; the countdown phase exists in the type model but is not currently used.

Pitch accuracy is calculated in [services/gameEngine.ts](services/gameEngine.ts):

- Perfect: up to 10 cents from the target, accuracy `1.0`.
- Good: over 10 and up to 25 cents, accuracy decreases from `1.0` to `0.7`.
- OK: over 25 and up to 50 cents, accuracy decreases from `0.7` to `0.3`.
- Miss: over 50 cents, accuracy `0`.

Cents are folded by octave, so the same pitch class in another octave can still match. A successful hit currently awards 10 score points and uses a flat base damage of 2. Damage is accumulated through combos and released every 10 successful notes. Combo tiers are:

- Tier 1: fewer than 8 combo notes, multiplier 1.
- Tier 2: 8 through 17 combo notes, multiplier 2.
- Tier 3: 18 through 24 combo notes, multiplier 3.

The active attacker is determined by the current quarter of the song. A miss decreases the active player's combo by one. Player health starts at 20,000 in the game engine.

## 12. Media and Parsing

### MIDI

[services/midiParser.ts](services/midiParser.ts) parses MIDI data in the browser into `MidiNote` objects containing start time, duration, MIDI number, frequency, and velocity. It handles note-on, note-off, running status, common channel events, tempo meta events, and SysEx lengths.

The parser is intentionally lightweight. It assumes a conventional ticks-per-beat division and is most reliable with the single-track or straightforward MIDI files used by the supplied song data.

### LRC

[services/lrcParser.ts](services/lrcParser.ts) accepts timestamps such as `[01:23.45]` and `[01:23:45]`, ignores malformed lines, removes empty lyric lines, and sorts valid lines by time. `getLyricAtTime()` returns the last line whose timestamp has been reached.

Lyrics may be loaded from the `Lyrics` directory, pasted into the host, or searched through LRCLIB using the server proxy endpoint.

### Pitch detection

[services/pitchDetection.ts](services/pitchDetection.ts) uses autocorrelation. It rejects signals below an RMS threshold of `0.01`, then estimates the fundamental frequency from the strongest correlation period. This is simple and dependency-free, but background noise, weak singing, harmonics, and unvoiced sounds can reduce accuracy.

## 13. Song Packs and Assets

A song pack lives at `songs/<id>/song.json`. The pack combines the media needed for one selection:

```json
{
  "id": "example",
  "title": "Song title - Artist",
  "youtubeId": " eleven-character-id ",
  "syncOffset": 0,
  "duration": 180,
  "notes": [],
  "lyrics": []
}
```

`notes` contains `MidiNote` records and `lyrics` contains `LrcLine` records. The host loads a pack through `/songs/<id>/song.json`. The server lists lightweight pack metadata through `GET /api/songs`.

During play, the host can nudge a loaded pack by 0.25 seconds with `[` or `]`. The adjusted offset is applied to both notes and lyrics and is saved back through `POST /api/songs/:id/offset` after a short debounce.

Current supplied packs are under [songs](songs): `apt`, `bohemian-rhapsody`, `hey-jude`, `i-want-it-that-way`, and `im-yours`.

Manual source directories are also supported:

- `Midi Files/`: server-listed `.mid` and `.midi` files.
- `Lyrics/`: server-listed `.txt` files containing LRC text.
- `links.txt`: optional lines in the form `[Display name]https://youtube...`.

## 14. HTTP API

The Express server provides:

- `GET /api/songs`: list song-pack metadata.
- `POST /api/songs/:id/offset`: persist a pack's sync offset.
- `GET /api/midi-files`: list files in `Midi Files/`.
- `GET /midi/<filename>`: serve a MIDI file.
- `GET /api/youtube-links`: parse `links.txt`.
- `GET /api/lyrics-files`: list `.txt` files in `Lyrics/`.
- `GET /api/lyrics-file/<filename>`: return lyrics file content.
- `GET /lyrics/<filename>`: serve a lyrics file directly.
- `GET /api/lyrics/search?title=...&artist=...`: proxy a search to LRCLIB.
- `GET /songs/<id>/song.json`: serve a song pack statically.

Most failed file-list requests return an empty list so the host UI can still load. Invalid lyric-file and sync-offset requests return an error response.

## 15. Configuration and Environment

- Vite frontend port: `3000`.
- Express/Socket.IO port: `3001`, or `PORT` when supplied.
- `NGROK=true`: configures Vite HMR for the ngrok flow.
- `LAN_HTTPS=true`: enables Vite's basic SSL plugin.
- `GEMINI_API_KEY`: exposed to the frontend build as `process.env.API_KEY` and `process.env.GEMINI_API_KEY`; the Gemini service is present for future or auxiliary features and is not part of the core pitch loop.

The values in `constants.ts` include legacy game constants. The live combat values are defined in [services/gameEngine.ts](services/gameEngine.ts), so change that module when tuning current gameplay.

## 16. Troubleshooting

### Server connection fails

Confirm both processes are running and that ports 3000 and 3001 are available. Inspect the browser console and server log for Socket.IO connection errors.

### Phones cannot open the app

Use the host computer's LAN IP instead of `localhost`, confirm firewall access, and verify that all devices share the intended network. With ngrok, use the public HTTPS URL printed by the ngrok process.

### Microphone permission fails

Use `localhost`, HTTPS LAN mode, or an ngrok HTTPS URL. Grant browser permission and check that another application is not holding the microphone.

### Pitch is always blank or unstable

Sing clearly and loudly enough to exceed the RMS threshold. Test in a quieter room. The current detector is monophonic and may struggle with noise or heavy accompaniment.

### Notes and lyrics are out of sync

Use the host's `[` and `]` controls while a song pack is loaded. The offset changes both MIDI notes and lyrics and is persisted in the pack.

### A song cannot start

The host currently requires a connected host, both connected players, both players ready, a loaded YouTube ID, at least one MIDI note, and at least one parsed lyric line. The server itself allows a start without both ready flags for testing, but the host UI normally prevents that path.

## 17. Development Guide

When changing shared behavior:

1. Update the related TypeScript interfaces in `types.ts`.
2. Keep host and client Socket.IO event names aligned with [services/socketClient.ts](services/socketClient.ts) and [server/index.ts](server/index.ts).
3. Keep media timestamps in seconds.
4. Run `npm run build` after frontend or shared-type changes.
5. Test microphone permission and two simultaneous player connections on real devices when changing pitch or networking code.

Useful areas for future work include server-side validation of pitch payloads, persistent multi-room sessions, a more robust MIDI parser, improved pitch detection, an explicit countdown, automated tests for scoring and parsers, and production deployment configuration.

## 18. Repository Map

```text
App.tsx                         Routes and landing page
index.tsx                       React bootstrap
pages/HostPage.tsx              Host setup and authoritative game loop
pages/ClientPage.tsx            Player microphone and pitch UI
pages/NgrokSetup.tsx            Mobile tunnel information
components/SpriteFighter.tsx    Animated fighter rendering
components/Fighter.tsx          Alternate fighter component
components/KaraokeHighway.tsx   MIDI note visualization
services/gameEngine.ts          Accuracy, combos, damage, and turns
services/midiParser.ts          MIDI-to-note conversion
services/lrcParser.ts           LRC parsing and lyric lookup
services/pitchDetection.ts     Browser autocorrelation detector
services/socketClient.ts        Socket.IO client wrapper
server/index.ts                 Express APIs and Socket.IO session
songs/                          Matched song packs
Midi Files/                     Manual MIDI library
Lyrics/                         Manual LRC library
public/sprites/                 Fighter and arena assets
scripts/add-song.mjs            Song data helper
vite.config.ts                  Dev server, proxy, SPA fallback
start-ngrok.js                  ngrok launcher and URL writer
First draft/                    Historical implementation notes
```
