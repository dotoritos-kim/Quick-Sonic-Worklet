/**
 * EQ 밴드 설정
 */
export interface EQBand {
    /** 중심 주파수 (Hz) - 예: 60, 250, 1000, 4000 등 */
    frequency: number;
    /** 게인 (dB) - 범위: -12 ~ +12 권장 */
    gain: number;
}

/**
 * 모듈레이션 타입
 * - chorus: 코러스 효과 (딜레이 변조)
 * - vibrato: 비브라토 효과 (피치 변조)
 * - flanger: 플랜저 효과 (짧은 딜레이 + 피드백)
 * - tremolo: 트레몰로 효과 (진폭 변조)
 * - ring: 링 모듈레이션 (캐리어와 곱셈)
 * - square/triangle/sawtooth: 파형 기반 변조
 */
export type ModulationType = 'chorus' | 'vibrato' | 'flanger' | 'tremolo' | 'ring' | 'square' | 'triangle' | 'sawtooth' | 'adjustNormalize';

/**
 * 모듈레이션 효과 설정
 */
export interface ModulationSettings {
    /** 모듈레이션 깊이 - 범위: 0.0 ~ 1.0 (0: 효과 없음, 1: 최대) */
    depth: number;
    /** 모듈레이션 속도 (Hz) - 범위: 0.1 ~ 20.0 권장 */
    rate: number;
    /** 모듈레이션 타입 */
    type: ModulationType;
}

/**
 * 리버브 룸 사이즈 프리셋
 * - small: 작은 방 (짧은 잔향)
 * - medium: 중간 크기 방
 * - large: 큰 방
 * - hall: 콘서트 홀 (긴 잔향)
 * - plate: 플레이트 리버브
 * - cathedral: 성당 (매우 긴 잔향)
 */
export type ReverbRoomSize = 'small' | 'medium' | 'large' | 'hall' | 'plate' | 'cathedral';

/**
 * 이펙트 설정 (Delay, Reverb, Echo)
 */
export interface EffectsSettings {
    /** 딜레이 시간 (ms) - 범위: 0 ~ 2000 */
    delay?: number;
    /** 리버브 믹스량 - 범위: 0.0 ~ 1.0 (0: 드라이, 1: 풀 웻) */
    reverb?: number;
    /** 리버브 잔향 시간 (decay) - 범위: 0.0 ~ 1.0 (기본: 0.84) */
    reverbDecay?: number;
    /** 리버브 확산도 (diffusion) - 범위: 0.0 ~ 1.0 (기본: 0.5) */
    reverbDiffusion?: number;
    /** 룸 사이즈 프리셋 - 설정 시 reverbDecay/reverbDiffusion 자동 적용 */
    roomSize?: ReverbRoomSize;
    /** 에코 시간 (ms) - 범위: 0 ~ 1000 (다중 탭 에코 생성) */
    echo?: number;
    /** 루프 여부 (에코 무한 반복) */
    loop?: boolean;
}

/**
 * 드라이브 효과 설정 (Distortion, Overdrive, Fuzz)
 */
export interface DriveSettings {
    /** 디스토션 강도 - 범위: 0.0 ~ 1.0 (하드 클리핑) */
    distortion?: number;
    /** 오버드라이브 강도 - 범위: 0.0 ~ 1.0 (소프트 클리핑) */
    overdrive?: number;
    /** 퍼즈 강도 - 범위: 0.0 ~ 1.0 (비대칭 클리핑 + 하모닉스) */
    fuzz?: number;
}

/**
 * 다이나믹스 설정 (컴프레서)
 */
export interface DynamicsSettings {
    /** 컴프레션 적용 시작 레벨 (dB) - 범위: -60 ~ 0 (예: -24) */
    threshold: number;
    /** 컴프레션 비율 - 범위: 1 ~ 20 (예: 4는 4:1 압축) */
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
export function isVisualizerBand(obj: unknown): obj is VisualizerBand {
    if (obj === null || typeof obj !== 'object') return false;
    const record = obj as Record<string, unknown>;
    return typeof record.startFrequency === 'number' && typeof record.endFrequency === 'number';
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
        | 'adjustLatencySamples'
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
