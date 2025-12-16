// audio-processor.ts

import {
    AudioProcessorPostMessage,
    DriveSettings,
    DynamicsSettings,
    EffectsSettings,
    EQBand,
    ModulationSettings,
    ExtendedTrack,
    VisualizerBand,
    isVisualizerBand,
} from './types';

interface InitialSettings {
    eq: EQBand[];
    modulation: ModulationSettings;
    effects: EffectsSettings;
    drive: DriveSettings;
    dynamics: DynamicsSettings;
}

class AudioProcessor extends AudioWorkletProcessor {
    private tracks: Map<string, ExtendedTrack>;
    private masterVolume: number;
    private eqSettings: Map<string, EQBand[]>;
    private modulationSettings: Map<string, ModulationSettings>;
    private effectsSettings: Map<string, EffectsSettings>;
    private driveSettings: Map<string, DriveSettings>;
    private dynamicsSettings: Map<string, DynamicsSettings>;
    private normalizeEnabled: boolean = false;
    private latencySamples: number = 0;
    private readonly maxLatencySamples: number = sampleRate;
    private delayBufferL: Float32Array = new Float32Array(this.maxLatencySamples);
    private delayBufferR: Float32Array = new Float32Array(this.maxLatencySamples);
    private delayBufferIndex: number = 0;

    // ── 이펙트용 버퍼 및 상태 변수 ──
    // Delay/Echo 효과용 버퍼 (트랙별)
    private delayEffectBuffers: Map<string, Float32Array> = new Map();
    private delayEffectWriteIndices: Map<string, number> = new Map();
    private echoEffectBuffers: Map<string, Float32Array> = new Map();
    private echoEffectWriteIndices: Map<string, number> = new Map();
    
    // Chorus/Flanger 효과용 버퍼 (트랙별)
    private chorusBuffers: Map<string, Float32Array> = new Map();
    private chorusWriteIndices: Map<string, number> = new Map();
    
    // Reverb 효과용 - Schroeder Reverb implementation
    private reverbCombBuffers: Map<string, Float32Array[]> = new Map();
    private reverbCombIndices: Map<string, number[]> = new Map();
    private reverbAllpassBuffers: Map<string, Float32Array[]> = new Map();
    private reverbAllpassIndices: Map<string, number[]> = new Map();
    
    // 모듈레이션 LFO 위상 추적 (트랙별)
    private modulationPhases: Map<string, number> = new Map();
    
    // 버퍼 크기 상수
    private readonly MAX_DELAY_SAMPLES = sampleRate * 2; // 최대 2초 딜레이
    private readonly MAX_CHORUS_SAMPLES = Math.round(sampleRate * 0.05); // 최대 50ms 코러스 딜레이
    
    // Schroeder Reverb 파라미터
    private readonly COMB_DELAYS = [1557, 1617, 1491, 1422]; // 샘플 단위 콤 필터 딜레이
    private readonly ALLPASS_DELAYS = [225, 556, 441, 341]; // 샘플 단위 올패스 필터 딜레이

    // 기존 비주얼라이저 대역 설정은 그대로 유지
    private visualizerBands: VisualizerBand[] = [
        { startFrequency: 20, endFrequency: 250 },
        { startFrequency: 250, endFrequency: 500 },
        { startFrequency: 500, endFrequency: 2000 },
        { startFrequency: 2000, endFrequency: 4000 },
        { startFrequency: 4000, endFrequency: 6000 },
        { startFrequency: 6000, endFrequency: 20000 },
    ];

    // ★ 새로 추가된 부분: visualizer 버퍼 크기를 동적으로 조절 (기본 128)
    private visualizerBufferSize: number = 128;
    private visualizerSampleBuffer: Float32Array = new Float32Array(this.visualizerBufferSize);
    private visualizerSampleBufferIndex: number = 0;

    private readonly initialSettings: InitialSettings = {
        eq: [
            { frequency: 60, gain: 0 },
            { frequency: 170, gain: 0 },
            { frequency: 310, gain: 0 },
            { frequency: 600, gain: 0 },
            { frequency: 1000, gain: 0 },
            { frequency: 3000, gain: 0 },
            { frequency: 6000, gain: 0 },
            { frequency: 12000, gain: 0 },
        ],
        modulation: {
            type: 'chorus',
            depth: 0,
            rate: 0,
        },
        effects: {
            delay: 0,
            reverb: 0,
            echo: 0,
            loop: false,
        },
        drive: {
            distortion: 0,
            overdrive: 0,
            fuzz: 0,
        },
        dynamics: {
            threshold: -24,
            ratio: 4,
        },
    };

    constructor() {
        super();

        this.tracks = new Map();
        this.eqSettings = new Map();
        this.modulationSettings = new Map();
        this.effectsSettings = new Map();
        this.driveSettings = new Map();
        this.dynamicsSettings = new Map();
        this.masterVolume = 0.5;

        this.port.onmessage = (e: MessageEvent<AudioProcessorPostMessage>) => {
            const { type, key, data } = e.data;
            switch (type) {
                case 'play':
                    if (data && 'buffer' in data) {
                        // data.buffer는 이미 Float32Array이므로 복사본을 만듭니다.
                        const buffer = new Float32Array(data.buffer);
                        this.tracks.set(key, {
                            data: buffer,
                            readIndex: 0,
                            isPlaying: true,
                            loop: data.loop,
                            playbackRate: typeof data.playbackRate === 'number' ? data.playbackRate : 1,
                        });
                        // 신규 트랙에 대해 기본 설정 초기화
                        this.eqSettings.set(key, [...this.initialSettings.eq]);
                        this.modulationSettings.set(key, { ...this.initialSettings.modulation });
                        this.effectsSettings.set(key, { ...this.initialSettings.effects });
                        this.driveSettings.set(key, { ...this.initialSettings.drive });
                        this.dynamicsSettings.set(key, { ...this.initialSettings.dynamics });
                        
                        // 이펙트 버퍼 초기화
                        this.initializeEffectBuffers(key);
                    }
                    break;
                case 'stop':
                    if (this.tracks.has(key)) {
                        this.tracks.get(key)!.isPlaying = false;
                    }
                    break;
                case 'clear':
                    this.tracks.delete(key);
                    this.eqSettings.delete(key);
                    this.modulationSettings.delete(key);
                    this.effectsSettings.delete(key);
                    this.driveSettings.delete(key);
                    this.dynamicsSettings.delete(key);
                    // 이펙트 버퍼 정리
                    this.clearEffectBuffers(key);
                    break;
                case 'adjustEQ':
                    if (Array.isArray(data)) {
                        this.eqSettings.set(key, data as EQBand[]);
                    }
                    break;
                case 'adjustModulation':
                    this.modulationSettings.set(key, data as ModulationSettings);
                    break;
                case 'adjustEffects':
                    this.effectsSettings.set(key, data as EffectsSettings);
                    break;
                case 'adjustDrive':
                    this.driveSettings.set(key, data as DriveSettings);
                    break;
                case 'adjustDynamics':
                    this.dynamicsSettings.set(key, data as DynamicsSettings);
                    break;
                // 노멀라이즈 기능 조절
                case 'adjustNormalize':
                    this.normalizeEnabled = Boolean(data);
                    break;
                // 출력 레이턴시 조절 (data: 밀리초 단위)
                case 'adjustLatency':
                    this.latencySamples = Math.round((Number(data) * sampleRate) / 1000);
                    break;
                // 출력 레이턴시 조절 (data: 샘플 단위)
                case 'adjustLatencySamples':
                    this.latencySamples = Math.min(Math.max(0, Math.round(Number(data))), this.maxLatencySamples);
                    break;
                // 비주얼라이저 대역 설정
                case 'setVisualizerBands':
                    if (Array.isArray(data) && data.every(isVisualizerBand)) {
                        this.visualizerBands = data;
                    }
                    break;
                // ★ 새로 추가: 비주얼라이저 FFT(또는 DFT) 버퍼 크기 설정 (32 ~ 1024)
                case 'setVisualizerBufferSize': {
                    const newSize = Number(data);
                    if (Number.isInteger(newSize) && newSize >= 32 && newSize <= 1024) {
                        this.visualizerBufferSize = newSize;
                        this.visualizerSampleBuffer = new Float32Array(this.visualizerBufferSize);
                        this.visualizerSampleBufferIndex = 0;
                    }
                    break;
                }
            }
        };
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const output = outputs[0];
        if (!output) return true;

        const left = output[0];
        const right = output[1] || left;
        const blockSize = left.length;

        // 출력 버퍼 초기화 (fill 사용)
        left.fill(0);
        right.fill(0);

        // 각 트랙의 데이터를 믹스
        for (const [trackKey, track] of this.tracks.entries()) {
            if (!track.isPlaying) continue;

            // 매번 새로운 버퍼를 할당하는 대신, 블록 크기만큼의 임시 버퍼를 사용합니다.
            const trackBuffer = new Float32Array(blockSize);

            // 트랙 데이터를 선형 보간을 사용해 임시 버퍼에 채웁니다.
            for (let i = 0; i < blockSize; i++) {
                if (track.readIndex >= track.data.length - 1) {
                    if (track.loop) {
                        track.readIndex %= track.data.length;
                    } else {
                        track.isPlaying = false;
                        break;
                    }
                }
                const i0 = Math.floor(track.readIndex);
                const frac = track.readIndex - i0;
                const sample1 = track.data[i0];
                const sample2 = i0 + 1 < track.data.length ? track.data[i0 + 1] : sample1;
                trackBuffer[i] = sample1 * (1 - frac) + sample2 * frac;
                track.readIndex += track.playbackRate;
            }

            // 각 이펙트 및 처리 기능을 in-place 방식으로 적용해 불필요한 메모리 복사를 줄입니다.
            const eqBands = this.eqSettings.get(trackKey) || this.initialSettings.eq;
            const modulation = this.modulationSettings.get(trackKey) || this.initialSettings.modulation;
            const effects = this.effectsSettings.get(trackKey) || this.initialSettings.effects;
            const drive = this.driveSettings.get(trackKey) || this.initialSettings.drive;
            const dynamics = this.dynamicsSettings.get(trackKey) || this.initialSettings.dynamics;

            this.applyEQInPlace(trackBuffer, eqBands);
            if (modulation.depth !== 0 || modulation.rate !== 0) {
                this.applyModulationInPlace(trackBuffer, modulation, trackKey);
            }
            if (effects.delay || effects.reverb || effects.echo) {
                this.applyEffectsInPlace(trackBuffer, effects, trackKey);
            }
            if (drive.distortion || drive.overdrive || drive.fuzz) {
                this.applyDriveInPlace(trackBuffer, drive);
            }
            if (dynamics.threshold !== 0 || dynamics.ratio !== 1) {
                this.applyDynamicsInPlace(trackBuffer, dynamics);
            }

            // 처리된 트랙 버퍼를 메인 출력에 믹스합니다.
            for (let i = 0; i < blockSize; i++) {
                left[i] += trackBuffer[i];
                right[i] += trackBuffer[i];
            }
        }

        // 노멀라이즈 처리 (활성화 시)
        if (this.normalizeEnabled) {
            let maxVal = 0;
            for (let i = 0; i < blockSize; i++) {
                const absL = Math.abs(left[i]);
                const absR = Math.abs(right[i]);
                if (absL > maxVal) maxVal = absL;
                if (absR > maxVal) maxVal = absR;
            }
            if (maxVal > 0) {
                const invMax = 1 / maxVal;
                for (let i = 0; i < blockSize; i++) {
                    left[i] *= invMax;
                    right[i] *= invMax;
                }
            }
        }

        // 마스터 볼륨 적용
        for (let i = 0; i < blockSize; i++) {
            left[i] *= this.masterVolume;
            right[i] *= this.masterVolume;
        }

        // 출력 레이턴시 적용 (latencySamples > 0 인 경우)
        if (this.latencySamples > 0) {
            for (let i = 0; i < blockSize; i++) {
                const writeIndex = (this.delayBufferIndex + i) % this.maxLatencySamples;
                const readIndex = (writeIndex + this.maxLatencySamples - this.latencySamples) % this.maxLatencySamples;
                this.delayBufferL[writeIndex] = left[i];
                this.delayBufferR[writeIndex] = right[i];
                left[i] = this.delayBufferL[readIndex];
                right[i] = this.delayBufferR[readIndex];
            }
            this.delayBufferIndex = (this.delayBufferIndex + blockSize) % this.maxLatencySamples;
        }

        // ★ 새로 추가된 부분: 비주얼라이저를 위한 샘플 누적
        // 각 블록의 좌/우 평균 샘플을 visualizerSampleBuffer에 추가합니다.
        let sampleIdx = 0;
        while (sampleIdx < blockSize) {
            // 남은 샘플 수와 버퍼에 채울 수 있는 공간 중 작은 값을 결정
            const remainingBlockSamples = blockSize - sampleIdx;
            const remainingBufferSpace = this.visualizerBufferSize - this.visualizerSampleBufferIndex;
            const copyCount = Math.min(remainingBlockSamples, remainingBufferSpace);

            // 현재 블록에서 copyCount만큼 샘플 복사 (좌우 평균)
            for (let i = 0; i < copyCount; i++) {
                const sample = (left[sampleIdx + i] + right[sampleIdx + i]) * 0.5;
                this.visualizerSampleBuffer[this.visualizerSampleBufferIndex + i] = sample;
            }
            this.visualizerSampleBufferIndex += copyCount;
            sampleIdx += copyCount;

            // 버퍼가 꽉 찼으면 DFT 계산 후 메인 스레드로 전송하고, 버퍼를 리셋합니다.
            if (this.visualizerSampleBufferIndex === this.visualizerBufferSize) {
                const N = this.visualizerBufferSize;
                const magnitudes = new Float32Array(N);
                for (let k = 0; k < N; k++) {
                    let re = 0;
                    let im = 0;
                    for (let n = 0; n < N; n++) {
                        const angle = (2 * Math.PI * k * n) / N;
                        re += this.visualizerSampleBuffer[n] * Math.cos(angle);
                        im -= this.visualizerSampleBuffer[n] * Math.sin(angle);
                    }
                    magnitudes[k] = Math.hypot(re, im);
                }
                // 각 대역의 평균 magnitude 계산
                const bandsLevels: number[] = [];
                for (const band of this.visualizerBands) {
                    let sum = 0;
                    let count = 0;
                    for (let k = 0; k < N; k++) {
                        const freq = (k * sampleRate) / N;
                        if (freq >= band.startFrequency && freq < band.endFrequency) {
                            sum += magnitudes[k];
                            count++;
                        }
                    }
                    bandsLevels.push(count > 0 ? sum / count : 0);
                }
                // 메인 스레드에 전송
                this.port.postMessage({ type: 'visualizerData', data: bandsLevels });
                // 버퍼 인덱스 초기화 (남은 샘플은 이미 처리되었으므로)
                this.visualizerSampleBufferIndex = 0;
            }
        }

        return true;
    }

    // ── In-Place Processing Functions ──

    private applyEQInPlace(buffer: Float32Array, eqBands: EQBand[]): Float32Array {
        for (const band of eqBands) {
            if (band.gain !== 0) {
                const alpha = this.computeAlpha(band.frequency);
                let state = 0;
                const gainFactor = Math.pow(10, band.gain / 20);
                for (let i = 0; i < buffer.length; i++) {
                    state += alpha * (buffer[i] - state);
                    buffer[i] += state * gainFactor;
                }
            }
        }
        return buffer;
    }

    /**
     * 향상된 모듈레이션 효과 적용
     * - LFO 위상을 지속적으로 추적하여 블록 간 연속성 보장
     * - Chorus/Flanger는 전용 딜레이 버퍼 사용
     */
    private applyModulationInPlace(buffer: Float32Array, modulation: ModulationSettings, trackKey: string): Float32Array {
        const fs = sampleRate;
        
        // 현재 LFO 위상 가져오기 (없으면 0)
        let phase = this.modulationPhases.get(trackKey) || 0;
        const phaseIncrement = (2 * Math.PI * modulation.rate) / fs;
        
        // Chorus/Flanger용 버퍼 가져오기
        const chorusBuffer = this.chorusBuffers.get(trackKey);
        let chorusWriteIndex = this.chorusWriteIndices.get(trackKey) || 0;
        
        for (let i = 0; i < buffer.length; i++) {
            const lfo = Math.sin(phase);
            let modFactor = 1;
            let processedSample = buffer[i];
            
            switch (modulation.type) {
                case 'chorus':
                    // Chorus: 딜레이된 신호와 원본을 혼합
                    if (chorusBuffer) {
                        // 기본 딜레이 15ms + 변조 ±10ms
                        const baseDelaySamples = Math.round(0.015 * fs);
                        const modulationDelaySamples = Math.round(0.010 * fs * lfo * modulation.depth);
                        const delaySamples = Math.max(1, baseDelaySamples + modulationDelaySamples);
                        
                        const readIndex = (chorusWriteIndex - delaySamples + this.MAX_CHORUS_SAMPLES) % this.MAX_CHORUS_SAMPLES;
                        const delayedSample = chorusBuffer[Math.floor(readIndex)];
                        
                        chorusBuffer[chorusWriteIndex] = buffer[i];
                        chorusWriteIndex = (chorusWriteIndex + 1) % this.MAX_CHORUS_SAMPLES;
                        
                        // 원본과 딜레이된 신호를 혼합 (0.5:0.5)
                        processedSample = buffer[i] * 0.7 + delayedSample * 0.3 * modulation.depth;
                    }
                    break;
                    
                case 'flanger':
                    // Flanger: 매우 짧은 딜레이 (0.1~10ms)와 피드백
                    if (chorusBuffer) {
                        const flangerDelaySamples = Math.round((0.0001 + 0.01 * (0.5 + 0.5 * lfo) * modulation.depth) * fs);
                        
                        const readIndex = (chorusWriteIndex - flangerDelaySamples + this.MAX_CHORUS_SAMPLES) % this.MAX_CHORUS_SAMPLES;
                        const delayedSample = chorusBuffer[Math.floor(readIndex)];
                        
                        // 피드백 포함
                        processedSample = buffer[i] + delayedSample * 0.7 * modulation.depth;
                        chorusBuffer[chorusWriteIndex] = processedSample;
                        chorusWriteIndex = (chorusWriteIndex + 1) % this.MAX_CHORUS_SAMPLES;
                    }
                    break;
                    
                case 'vibrato':
                    // Vibrato: 피치 변조 (딜레이 시간 변조로 시뮬레이션)
                    if (chorusBuffer) {
                        const vibratoDelaySamples = Math.round((0.002 + 0.003 * (0.5 + 0.5 * lfo) * modulation.depth) * fs);
                        
                        const readIndex = (chorusWriteIndex - vibratoDelaySamples + this.MAX_CHORUS_SAMPLES) % this.MAX_CHORUS_SAMPLES;
                        const frac = readIndex - Math.floor(readIndex);
                        const idx0 = Math.floor(readIndex);
                        const idx1 = (idx0 + 1) % this.MAX_CHORUS_SAMPLES;
                        
                        // 선형 보간
                        processedSample = chorusBuffer[idx0] * (1 - frac) + chorusBuffer[idx1] * frac;
                        chorusBuffer[chorusWriteIndex] = buffer[i];
                        chorusWriteIndex = (chorusWriteIndex + 1) % this.MAX_CHORUS_SAMPLES;
                    }
                    break;
                    
                case 'ring':
                    // Ring Modulation: 캐리어 신호와 곱셈
                    processedSample = buffer[i] * lfo * modulation.depth + buffer[i] * (1 - modulation.depth);
                    break;
                    
                case 'tremolo':
                    // Tremolo: 진폭 변조 (부드러운 0.5~1.0 범위)
                    modFactor = 1 - modulation.depth * 0.5 * (1 - lfo);
                    processedSample = buffer[i] * modFactor;
                    break;
                    
                case 'square':
                    // Square Wave 변조
                    modFactor = lfo >= 0 ? 1 + modulation.depth * 0.5 : 1 - modulation.depth * 0.5;
                    processedSample = buffer[i] * modFactor;
                    break;
                    
                case 'triangle':
                    // Triangle Wave 변조
                    const triangleLfo = (2 / Math.PI) * Math.asin(lfo);
                    modFactor = 1 + triangleLfo * modulation.depth * 0.5;
                    processedSample = buffer[i] * modFactor;
                    break;
                    
                case 'sawtooth':
                    // Sawtooth Wave 변조
                    const normalizedPhase = (phase % (2 * Math.PI)) / (2 * Math.PI);
                    const sawtoothLfo = 2 * (normalizedPhase - 0.5);
                    modFactor = 1 + sawtoothLfo * modulation.depth * 0.5;
                    processedSample = buffer[i] * modFactor;
                    break;
                    
                default:
                    processedSample = buffer[i];
            }
            
            buffer[i] = processedSample;
            phase += phaseIncrement;
            
            // 위상 오버플로우 방지
            if (phase >= 2 * Math.PI) {
                phase -= 2 * Math.PI;
            }
        }
        
        // 상태 저장
        this.modulationPhases.set(trackKey, phase);
        if (chorusBuffer) {
            this.chorusWriteIndices.set(trackKey, chorusWriteIndex);
        }
        
        return buffer;
    }

    /**
     * 향상된 이펙트 적용 (Delay, Echo, Reverb)
     * - Delay: 시간 기반 딜레이 (ms 단위)
     * - Echo: 감쇄되는 반복 딜레이
     * - Reverb: Schroeder Reverb 알고리즘
     */
    private applyEffectsInPlace(buffer: Float32Array, effects: EffectsSettings, trackKey: string): Float32Array {
        const fs = sampleRate;
        
        // Delay 효과 적용
        if (effects.delay && effects.delay > 0) {
            const delayBuffer = this.delayEffectBuffers.get(trackKey);
            if (delayBuffer) {
                let writeIndex = this.delayEffectWriteIndices.get(trackKey) || 0;
                // delay 값을 ms로 해석 (0-1000ms 범위)
                const delaySamples = Math.min(
                    Math.round((effects.delay / 1000) * fs),
                    this.MAX_DELAY_SAMPLES - 1
                );
                
                for (let i = 0; i < buffer.length; i++) {
                    const readIndex = (writeIndex - delaySamples + this.MAX_DELAY_SAMPLES) % this.MAX_DELAY_SAMPLES;
                    const delayedSample = delayBuffer[readIndex];
                    
                    // 피드백 0.3 적용
                    delayBuffer[writeIndex] = buffer[i] + delayedSample * 0.3;
                    buffer[i] = buffer[i] * 0.7 + delayedSample * 0.5;
                    
                    writeIndex = (writeIndex + 1) % this.MAX_DELAY_SAMPLES;
                }
                this.delayEffectWriteIndices.set(trackKey, writeIndex);
            }
        }
        
        // Echo 효과 적용
        if (effects.echo && effects.echo > 0) {
            const echoBuffer = this.echoEffectBuffers.get(trackKey);
            if (echoBuffer) {
                let writeIndex = this.echoEffectWriteIndices.get(trackKey) || 0;
                // echo 값을 ms로 해석 (0-1000ms 범위)
                const echoSamples = Math.min(
                    Math.round((effects.echo / 1000) * fs),
                    this.MAX_DELAY_SAMPLES - 1
                );
                
                // 다중 에코 탭: 1x, 2x, 3x 딜레이에서 감쇄되는 에코
                const echoTaps = [
                    { delay: echoSamples, gain: 0.5 },
                    { delay: echoSamples * 2, gain: 0.25 },
                    { delay: echoSamples * 3, gain: 0.125 },
                ];
                
                for (let i = 0; i < buffer.length; i++) {
                    let echoSum = 0;
                    for (const tap of echoTaps) {
                        if (tap.delay < this.MAX_DELAY_SAMPLES) {
                            const readIndex = (writeIndex - tap.delay + this.MAX_DELAY_SAMPLES) % this.MAX_DELAY_SAMPLES;
                            echoSum += echoBuffer[readIndex] * tap.gain;
                        }
                    }
                    
                    echoBuffer[writeIndex] = buffer[i];
                    buffer[i] += echoSum;
                    
                    writeIndex = (writeIndex + 1) % this.MAX_DELAY_SAMPLES;
                }
                this.echoEffectWriteIndices.set(trackKey, writeIndex);
            }
        }
        
        // Reverb 효과 적용 (Schroeder Reverb)
        if (effects.reverb && effects.reverb > 0) {
            const combBuffers = this.reverbCombBuffers.get(trackKey);
            const combIndices = this.reverbCombIndices.get(trackKey);
            const allpassBuffers = this.reverbAllpassBuffers.get(trackKey);
            const allpassIndices = this.reverbAllpassIndices.get(trackKey);
            
            if (combBuffers && combIndices && allpassBuffers && allpassIndices) {
                const reverbMix = Math.min(1, effects.reverb);
                
                // 외부 파라미터 또는 프리셋에서 decay/diffusion 가져오기
                const { combFeedback, allpassFeedback } = this.getReverbParams(effects);
                
                for (let i = 0; i < buffer.length; i++) {
                    const input = buffer[i];
                    let combOutput = 0;
                    
                    // 4개의 병렬 콤 필터
                    for (let c = 0; c < 4; c++) {
                        const combBuffer = combBuffers[c];
                        const idx = combIndices[c];
                        const delay = this.COMB_DELAYS[c] % combBuffer.length;
                        
                        const readIdx = (idx - delay + combBuffer.length) % combBuffer.length;
                        const combSample = combBuffer[readIdx];
                        
                        combBuffer[idx] = input + combSample * combFeedback;
                        combOutput += combSample;
                        
                        combIndices[c] = (idx + 1) % combBuffer.length;
                    }
                    combOutput *= 0.25; // 평균화
                    
                    // 2개의 직렬 올패스 필터
                    let allpassOutput = combOutput;
                    for (let a = 0; a < 2; a++) {
                        const allpassBuffer = allpassBuffers[a];
                        const idx = allpassIndices[a];
                        const delay = this.ALLPASS_DELAYS[a] % allpassBuffer.length;
                        
                        const readIdx = (idx - delay + allpassBuffer.length) % allpassBuffer.length;
                        const bufferSample = allpassBuffer[readIdx];
                        
                        const feedforward = -allpassFeedback * allpassOutput + bufferSample;
                        allpassBuffer[idx] = allpassOutput + allpassFeedback * feedforward;
                        allpassOutput = feedforward;
                        
                        allpassIndices[a] = (idx + 1) % allpassBuffer.length;
                    }
                    
                    // Wet/Dry 믹스
                    buffer[i] = input * (1 - reverbMix) + allpassOutput * reverbMix;
                }
            }
        }
        
        return buffer;
    }

    private applyDriveInPlace(buffer: Float32Array, drive: DriveSettings): Float32Array {
        for (let i = 0; i < buffer.length; i++) {
            let sample = buffer[i];
            
            if (drive.distortion) {
                // 하드 클리핑 기반 디스토션
                const gain = 1 + drive.distortion * 10;
                sample = Math.tanh(gain * sample);
            }
            
            if (drive.overdrive) {
                // 소프트 클리핑 기반 오버드라이브
                const gain = 1 + drive.overdrive * 5;
                const driveSignal = gain * sample;
                sample = Math.sign(driveSignal) * (1 - Math.exp(-Math.abs(driveSignal)));
            }
            
            if (drive.fuzz) {
                // 비대칭 클리핑 기반 퍼즈
                const fuzzGain = 1 + drive.fuzz * 20;
                const fuzzSignal = fuzzGain * sample;
                if (fuzzSignal > 0) {
                    sample = Math.min(1, fuzzSignal);
                } else {
                    sample = Math.max(-0.7, fuzzSignal * 0.7);
                }
                // 추가 하모닉스
                sample = sample + 0.3 * Math.sin(3 * Math.PI * sample);
            }
            
            buffer[i] = sample;
        }
        return buffer;
    }

    private applyDynamicsInPlace(buffer: Float32Array, dynamics: DynamicsSettings): Float32Array {
        let envelope = 0;
        const attack = 0.003;
        const release = 0.25;
        const threshold = Math.pow(10, dynamics.threshold / 20);
        
        for (let i = 0; i < buffer.length; i++) {
            const inputLevel = Math.abs(buffer[i]);
            envelope += inputLevel > envelope 
                ? attack * (inputLevel - envelope) 
                : release * (inputLevel - envelope);
            
            let gainReduction = 1;
            if (envelope > threshold) {
                const dbAboveThreshold = 20 * Math.log10(envelope / threshold);
                const dbReduction = dbAboveThreshold * (1 - 1 / dynamics.ratio);
                gainReduction = Math.pow(10, -dbReduction / 20);
            }
            buffer[i] *= gainReduction;
        }
        return buffer;
    }

    private computeAlpha(fc: number): number {
        const fs = sampleRate;
        const dt = 1 / fs;
        const RC = 1.0 / (2 * Math.PI * fc);
        return dt / (RC + dt);
    }

    // ── 이펙트 버퍼 관리 함수 ──

    /**
     * 트랙의 이펙트 버퍼 초기화
     */
    private initializeEffectBuffers(trackKey: string): void {
        // Delay/Echo 버퍼
        this.delayEffectBuffers.set(trackKey, new Float32Array(this.MAX_DELAY_SAMPLES));
        this.delayEffectWriteIndices.set(trackKey, 0);
        this.echoEffectBuffers.set(trackKey, new Float32Array(this.MAX_DELAY_SAMPLES));
        this.echoEffectWriteIndices.set(trackKey, 0);
        
        // Chorus/Flanger/Vibrato 버퍼
        this.chorusBuffers.set(trackKey, new Float32Array(this.MAX_CHORUS_SAMPLES));
        this.chorusWriteIndices.set(trackKey, 0);
        
        // Schroeder Reverb 버퍼 초기화
        const combBuffers: Float32Array[] = [];
        const combIndices: number[] = [];
        for (const delay of this.COMB_DELAYS) {
            combBuffers.push(new Float32Array(delay + 1));
            combIndices.push(0);
        }
        this.reverbCombBuffers.set(trackKey, combBuffers);
        this.reverbCombIndices.set(trackKey, combIndices);
        
        const allpassBuffers: Float32Array[] = [];
        const allpassIndices: number[] = [];
        for (const delay of this.ALLPASS_DELAYS) {
            allpassBuffers.push(new Float32Array(delay + 1));
            allpassIndices.push(0);
        }
        this.reverbAllpassBuffers.set(trackKey, allpassBuffers);
        this.reverbAllpassIndices.set(trackKey, allpassIndices);
        
        // 모듈레이션 LFO 위상
        this.modulationPhases.set(trackKey, 0);
    }

    /**
     * 트랙의 이펙트 버퍼 정리
     */
    private clearEffectBuffers(trackKey: string): void {
        this.delayEffectBuffers.delete(trackKey);
        this.delayEffectWriteIndices.delete(trackKey);
        this.echoEffectBuffers.delete(trackKey);
        this.echoEffectWriteIndices.delete(trackKey);
        this.chorusBuffers.delete(trackKey);
        this.chorusWriteIndices.delete(trackKey);
        this.reverbCombBuffers.delete(trackKey);
        this.reverbCombIndices.delete(trackKey);
        this.reverbAllpassBuffers.delete(trackKey);
        this.reverbAllpassIndices.delete(trackKey);
        this.modulationPhases.delete(trackKey);
    }

    /**
     * 리버브 파라미터 계산 (프리셋 또는 커스텀 값)
     * @param effects - 이펙트 설정
     * @returns combFeedback (decay), allpassFeedback (diffusion)
     */
    private getReverbParams(effects: EffectsSettings): { combFeedback: number; allpassFeedback: number } {
        // 기본값
        const DEFAULT_DECAY = 0.84;
        const DEFAULT_DIFFUSION = 0.5;
        
        // 룸 사이즈 프리셋
        const ROOM_PRESETS: Record<string, { decay: number; diffusion: number }> = {
            small: { decay: 0.7, diffusion: 0.4 },
            medium: { decay: 0.8, diffusion: 0.5 },
            large: { decay: 0.85, diffusion: 0.55 },
            hall: { decay: 0.9, diffusion: 0.6 },
            plate: { decay: 0.88, diffusion: 0.7 },
            cathedral: { decay: 0.95, diffusion: 0.65 },
        };
        
        let combFeedback = DEFAULT_DECAY;
        let allpassFeedback = DEFAULT_DIFFUSION;
        
        // 프리셋이 설정된 경우 프리셋 값 사용
        if (effects.roomSize && ROOM_PRESETS[effects.roomSize]) {
            const preset = ROOM_PRESETS[effects.roomSize];
            combFeedback = preset.decay;
            allpassFeedback = preset.diffusion;
        }
        
        // 커스텀 값이 있으면 프리셋 값을 오버라이드
        if (effects.reverbDecay !== undefined) {
            combFeedback = Math.max(0, Math.min(0.99, effects.reverbDecay));
        }
        if (effects.reverbDiffusion !== undefined) {
            allpassFeedback = Math.max(0, Math.min(0.99, effects.reverbDiffusion));
        }
        
        return { combFeedback, allpassFeedback };
    }
}

registerProcessor('audio-worklet-processor', AudioProcessor);
export default '';
