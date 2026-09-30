# 🎤 KARAOKE COMBAT: Multiplayer Pitch Fighter

For the complete end-to-end architecture, runtime flow, protocol, file formats, and development guide, see [PROJECT_DOCUMENTATION.md](PROJECT_DOCUMENTATION.md).

A local multiplayer karaoke fighting game where two players battle using their singing voices. Match the pitch of scrolling MIDI notes to deal damage to your opponent!

## 🎮 Game Overview

- **2 Players** compete head-to-head on the same local network
- **YouTube audio** provides the backing track
- **MIDI file** defines the notes players must match
- **LRC lyrics** (optional) display synced lyrics
- **Turn-based combat**: Song is split into 4 segments, players alternate attacking

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    LOCAL NETWORK                        │
├─────────────────────────────────────────────────────────┤
│   Server (port 3001)                                    │
│   └── Socket.IO hub for real-time communication         │
│                                                         │
│   Host UI (port 3000/host)                              │
│   └── Main display: YouTube, MIDI viz, fighters, HP     │
│                                                         │
│   Client 1 (port 3000/client?p=1)                       │
│   └── Phone: Mic capture + pitch detection              │
│                                                         │
│   Client 2 (port 3000/client?p=2)                       │
│   └── Phone: Mic capture + pitch detection              │
└─────────────────────────────────────────────────────────┘
```

## 📋 Prerequisites

- **Node.js** v18 or higher (or Docker)
- **npm** v9 or higher
- All devices on the **same local network**
- Microphone access on player devices

## 🐳 Docker Quick Start

### Production (single container with nginx + server)

```bash
# Build and run
docker compose up --build -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

Access at:
- Host: http://localhost:3000/host
- Player 1: http://localhost:3000/client?p=1
- Player 2: http://localhost:3000/client?p=2

### Development (hot reload)

```bash
docker compose --profile dev up --build
```

### With Ngrok (public URLs for mobile)

```bash
# Add your ngrok authtoken to .env first
docker compose --profile ngrok up --build
```

Ngrok dashboard: http://localhost:4040

## 🚀 Quick Start (Local Node.js)

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the Game

```bash
npm run dev
```

This starts:
- **Server** on port 3001
- **Client** on port 3000
- **Ngrok tunnels** for mobile access from anywhere

The terminal will display the **ngrok URLs** that mobile devices can use to connect from any network (WiFi or cellular data).

The Host UI will show a **green banner** with copyable URLs for:
- 🖥️ Host UI
- 🎤 Player 1
- 🎤 Player 2

**Mobile players can connect from anywhere using these ngrok URLs!**

> **Note**: The ngrok authtoken is already configured in the project.

#### Alternative: Local Network Only (No Ngrok)

If you only want localhost/LAN access without ngrok:

```bash
npm run dev:local
```

**Access URLs (same WiFi only):**
| Role | URL | Device |
|------|-----|--------|
| Host | `http://localhost:3000/host` | Main display (TV/monitor) |
| Player 1 | `http://<host-ip>:3000/client?p=1` | Phone/tablet (same WiFi) |
| Player 2 | `http://<host-ip>:3000/client?p=2` | Phone/tablet (same WiFi) |

> **Note**: Replace `<host-ip>` with your computer's local IP address (e.g., `192.168.1.100`)

### 3. Setup the Song

On the **Host UI**:
1. Paste a **YouTube URL** and click "Load"
2. Upload a **MIDI file** (.mid) of the song
3. (Optional) Paste **LRC lyrics** and click "Parse Lyrics"

### 4. Ready Up

On each **Client UI**:
1. Click "Enable Microphone"
2. Click "Ready Up"

### 5. Start the Battle!

Once both players are ready, the Host can click **START BATTLE**.

## 🎯 Game Mechanics

### Segments
The song is divided into **4 equal segments**:
- Segment 1: Player 1 attacks
- Segment 2: Player 2 attacks
- Segment 3: Player 1 attacks
- Segment 4: Player 2 attacks

### Scoring
- **Perfect pitch** (within 10 cents): 100% accuracy → 20 damage
- **Good pitch** (within 25 cents): 70-100% accuracy → 15-20 damage
- **OK pitch** (within 50 cents): 30-70% accuracy → 9-15 damage
- **Miss** (>50 cents off): 0 damage

### Win Conditions
1. Reduce opponent's HP to 0 → **KO Victory**
2. Song ends → **Higher score wins**
3. Tie score → **Higher accuracy % wins**

## 📁 Project Structure

```
ConuhacksX-VC/
├── server/
│   └── index.ts              # Socket.IO server
├── pages/
│   ├── HostPage.tsx          # Host UI
│   └── ClientPage.tsx        # Client/Player UI
├── components/
│   ├── Fighter.tsx           # Fighter character display
│   └── KaraokeHighway.tsx    # Scrolling note visualization
├── services/
│   ├── socketClient.ts       # Socket.IO client wrapper
│   ├── pitchDetection.ts     # Autocorrelation pitch detection
│   ├── midiParser.ts         # MIDI file parser
│   ├── lrcParser.ts          # LRC lyrics parser
│   └── gameEngine.ts         # Game logic & scoring
├── types.ts                  # TypeScript interfaces
├── constants.ts              # Game constants
├── App.tsx                   # React router
└── index.tsx                 # Entry point
```

## 🔧 Configuration

Edit `constants.ts` to adjust:
- `MAX_HP` - Starting health (default: 100)
- `BASE_DAMAGE` - Minimum damage per hit (default: 5)
- `MAX_BONUS_DAMAGE` - Maximum bonus damage (default: 15)
- `PERFECT_THRESHOLD_CENTS` - Perfect pitch tolerance (default: 10)

## 🤖 Auto Song Pack Generation (NEW)

Generate complete song packs (MIDI + lyrics + metadata) from just a search query:

### Prerequisites

```bash
# Python dependencies
pip install -r requirements.txt
# → demucs, basic-pitch, yt-dlp

# Node dependencies (already in package.json)
npm install
```

### Usage

```bash
# Basic usage - search and auto-generate
npm run song:auto "APT ROSÉ Bruno Mars" --id apt

# Custom output directory
npm run song:auto "Bohemian Rhapsody Queen" --id bohemian-rhapsody --output ./songs

# Keep temp files for debugging
npm run song:auto "I'm Yours Jason Mraz" --id im-yours --keep-temp
```

### What it does automatically:

1. **Searches YTMusic** for the song → gets videoId, title, artist
2. **Fetches official synced lyrics** from YouTube Music
3. **Downloads audio** via yt-dlp
4. **Separates stems** with Demucs → clean vocals.wav + instrumental.wav
5. **Extracts MIDI** from vocals using Spotify's basic-pitch
6. **Selects melody track** using singability scoring (same as add-song.mjs)
7. **Monophonizes** the melody (removes harmonies)
8. **Measures duration** from instrumental
9. **Writes song.json** to `songs/<id>/song.json` - ready to play!

### Output structure:

```
songs/apt/
├── song.json          # Complete pack (notes, lyrics, metadata)
├── audio.mp3          # Original (if kept)
├── stems/
│   ├── vocals.wav     # Isolated vocal track
│   └── no_vocals.wav  # Clean instrumental
└── melody.mid         # Extracted MIDI
```

## 🎵 Adding MIDI Files

### Using the Midi Files Folder (Recommended)

1. Place your `.mid` or `.midi` files in the `Midi Files` folder in the project root
2. The Host UI will automatically detect and list them in a dropdown
3. Select your MIDI file from the dropdown - no upload needed!

### Uploading MIDI Files

Alternatively, you can upload MIDI files directly through the Host UI using the file upload button.

### Where to Find MIDI Files

You can find MIDI files for popular songs at:
- [BitMidi](https://bitmidi.com/)
- [FreeMidi](https://freemidi.org/)
- [MidiWorld](https://www.midiworld.com/)

## 📝 Getting LRC Lyrics

Lyrics are fetched from or can be pasted from:
- [lrclib.net](https://lrclib.net/) - Search by song title
- [Megalobiz](https://www.megalobiz.com/)

## 🐛 Troubleshooting

### "Cannot connect to server"
- Ensure the server is running (`npm run dev`)
- Check firewall settings for ports 3000 and 3001

### "Microphone not working"
- Grant microphone permissions in browser
- Use HTTPS or localhost (required for mic access)
- Check if another app is using the microphone

### "Players can't connect from phones"
- Use your computer's local IP, not `localhost`
- Ensure all devices are on the same WiFi network
- Check firewall allows incoming connections

### "Ngrok tunnels not working"
- Ensure you're running `npm run dev:mobile` (not just `npm run dev`)
- Check that the ngrok URLs appear in the terminal output
- The Host UI will show a green banner with mobile URLs when ngrok is active
- If ngrok fails, check your internet connection
- Free ngrok accounts have session limits - tunnels may expire after a few hours

### "Mobile devices can't access ngrok URLs"
- Ensure mobile devices have internet access (can be on cellular data)
- Try opening the ngrok URL in a regular browser first to test
- Check that HTTPS warnings are accepted (ngrok uses HTTPS)
- Clear browser cache on mobile device

## 📜 License

MIT License
