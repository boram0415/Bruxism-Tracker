export type AudioUpdatePayload = {
  dBFS: number;
  threshold: number;
  stage1Pass: boolean;
  durationPass: boolean;
  isCalibrating: boolean;
  calibSecondsLeft: number;
};

export type ClipSavedPayload = {
  path: string;
};

export type BruxismModuleEvents = {
  onAudioUpdate: (payload: AudioUpdatePayload) => void;
  onDebug: (payload: { msg: string }) => void;
  onClipSaved: (payload: ClipSavedPayload) => void;
};
