export interface EQBand {
    frequency: number;
    gain: number;
}
export type ModulationType = 'chorus' | 'vibrato' | 'flanger' | 'tremolo' | 'ring' | 'square' | 'triangle' | 'sawtooth' | 'adjustNormalize';

export interface ModulationSettings {
    depth: number; // 모듈레이션 강도 (예: 0.1이면 10% 진폭 변동)
    rate: number; // 모듈레이션 속도 (Hz)
    type: ModulationType;
}

export interface EffectsSettings {
    delay?: number;
    reverb?: number;
    echo?: number;
    loop?: boolean;
}

export interface DriveSettings {
    distortion?: number;
    overdrive?: number;
    fuzz?: number;
}

export interface DynamicsSettings {
    threshold: number;
    ratio: number;
}

// 수정된 Track 인터페이스
export interface Track {
    data: Float32Array;
    readIndex: number;
    isPlaying: boolean;
    loop: boolean;
}

// 재생 배속을 포함하는 확장 Track 인터페이스 (필요 시)
export interface ExtendedTrack extends Track {
    playbackRate: number;
}

export interface VisualizerBand {
    startFrequency: number;
    endFrequency: number;
}
export function isVisualizerBand(obj: any): obj is VisualizerBand {
    return obj !== null && typeof obj === 'object' && typeof obj.startFrequency === 'number' && typeof obj.endFrequency === 'number';
}
// AudioProcessor로 전달되는 메시지 타입
export interface AudioProcessorPostMessage {
    type:
        | 'play'
        | 'stop'
        | 'clear'
        | 'adjustEQ'
        | 'adjustModulation'
        | 'adjustSpatial'
        | 'adjustEffects'
        | 'adjustDrive'
        | 'adjustDynamics'
        | 'adjustLatency'
        | 'setVisualizerBands'
        | 'setVisualizerBufferSize'
        | 'adjustNormalize';
    key: string;
    data?:
        | null // 'stop' 또는 'clear' 시
        | EQBand[]
        | { buffer: Float32Array; loop: boolean; playbackRate?: number } // 재생 시
        | ModulationSettings
        | EffectsSettings
        | DriveSettings
        | DynamicsSettings
        | VisualizerBand[]
        | Boolean;
}
