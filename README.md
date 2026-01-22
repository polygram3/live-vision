# live-vision

---

# Gemini Live Vision 👁️🎙️

A high-performance, real-time multimodal AI assistant. This application leverages the **Gemini 2.5 Live API** to process synchronized webcam frames and microphone input, creating a seamless "Vision-to-Voice" conversational experience.

![Version](https://img.shields.io/badge/version-1.1.0-blue)
![Gemini](https://img.shields.io/badge/Model-Gemini_2.5_Flash_Native_Audio-orange)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Core Features

- **Real-time Visual Context**: Stream 1080p-optimized webcam frames directly to Gemini for instant scene understanding.
- **Low-Latency Voice Interaction**: Continuous raw PCM audio streaming for human-like response times.
- **Smart Language Mirroring**: Enforced system instruction ensures the AI detects and responds in your exact language (e.g., switches between English and Hindi automatically).
- **Advanced UI/UX**:
  - **Dynamic Wave Visualizers**: Real-time feedback for both user and AI audio levels.
  - **Neural Link Visualization**: Pulse animations that react to the state of the conversation.
  - **Glassmorphism Design**: A sleek, dark-themed interface built for modern Mac and PC displays.
- **Privacy First**: 
  - Physical "Kill Link" button to terminate all streams immediately.
  - Responsive **Microphone Mute** control with visual indicators.
- **Synthetic Personas**: Selectable high-quality voices (Zephyr, Puck, Charon, Kore, Fenrir).

## 🚀 Technical Architecture

- **Frontend**: React 19 (Hooks, Refs, and StrictMode)
- **Audio Logic**: Custom Resampling (to 16kHz input / 24kHz output) and PCM encoding/decoding.
- **API Strategy**: `@google/genai` Live connection via WebSockets.
- **Environment**: Vite with custom `process.env` injection for secure API key handling.

## 🛠️ Local Installation

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher.
- **API Key**: A valid Google Gemini API Key from [Google AI Studio](https://aistudio.google.com/app/apikey).

### 2. Setup
```bash
# Clone the repository
git clone https://github.com/Lynk4/live-vision.git
cd live-vision

# Install dependencies
npm install
```

### 3. Environment Configuration
Create a `.env` file in the root directory:
```bash
# On Mac/Linux
touch .env
```
Add your API key using the following specific variable name: 
```env
VITE_API_KEY=your_actual_api_key_here
```

### 4. Running the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

## 💡 Troubleshooting

- **API Key Error**: Ensure your `.env` file uses `VITE_API_KEY`. If changes aren't reflecting, restart the development server (`npm run dev`) to allow Vite to re-inject the environment variables.
- **Mute Functionality**: The mute button is context-aware. If the AI is currently speaking, input is automatically ignored to prevent echo.
- **Camera/Mic Permissions**: Ensure your browser has permission to access media devices. On macOS, check *System Settings > Privacy & Security*.
- **Model Access**: This app uses `gemini-2.5-flash-native-audio-preview-12-2025`. Ensure your API key has access to the Gemini 2.5 preview models.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
