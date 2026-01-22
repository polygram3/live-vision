
export enum AppStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR'
}

export interface TranscriptionItem {
  type: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface LiveConfig {
  voiceName: 'Zephyr' | 'Puck' | 'Charon' | 'Kore' | 'Fenrir';
  systemInstruction: string;
}
