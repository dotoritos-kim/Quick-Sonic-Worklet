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
                this.applyModulationInPlace(trackBuffer, modulation);
            }
            if (effects.delay || effects.reverb || effects.echo) {
                this.applyEffectsInPlace(trackBuffer, effects);
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

    private applyModulationInPlace(buffer: Float32Array, modulation: ModulationSettings): Float32Array {
        const fs = sampleRate;
        for (let i = 0; i < buffer.length; i++) {
            const phase = (2 * Math.PI * modulation.rate * i) / fs;
            let modFactor = 1;
            switch (modulation.type) {
                case 'chorus':
                case 'vibrato':
                case 'ring':
                    modFactor = 1 + Math.sin(phase) * modulation.depth;
                    break;
                case 'flanger':
                    modFactor = 1 + Math.cos(phase) * modulation.depth;
                    break;
                case 'tremolo':
                    modFactor = 0.5 * (1 + Math.sin(phase));
                    break;
                case 'square':
                    modFactor = 1 + (Math.sin(phase) >= 0 ? modulation.depth : -modulation.depth);
                    break;
                case 'triangle':
                    modFactor = 1 + (2 / Math.PI) * Math.asin(Math.sin(phase)) * modulation.depth;
                    break;
                case 'sawtooth':
                    modFactor = 1 + 2 * (phase / (2 * Math.PI) - Math.floor(phase / (2 * Math.PI) + 0.5)) * modulation.depth;
                    break;
                default:
                    modFactor = 1;
            }
            buffer[i] *= modFactor;
        }
        return buffer;
    }

    private applyEffectsInPlace(buffer: Float32Array, effects: EffectsSettings): Float32Array {
        for (let i = 0; i < buffer.length; i++) {
            if (effects.delay) {
                const delayedSample = i >= effects.delay ? buffer[i - effects.delay] : 0;
                buffer[i] += delayedSample;
            }
            if (effects.echo) {
                const echoSample = i >= effects.echo ? buffer[i - effects.echo] * 0.5 : 0;
                buffer[i] += echoSample;
            }
            if (effects.reverb) {
                buffer[i] += effects.reverb * Math.random();
            }
        }
        return buffer;
    }

    private applyDriveInPlace(buffer: Float32Array, drive: DriveSettings): Float32Array {
        for (let i = 0; i < buffer.length; i++) {
            let sample = buffer[i];
            if (drive.distortion) {
                sample = Math.tanh(drive.distortion * sample);
            }
            if (drive.overdrive) {
                sample = Math.sign(sample) * (1 - Math.exp(-Math.abs(drive.overdrive * sample)));
            }
            if (drive.fuzz) {
                sample = Math.sin(drive.fuzz * sample);
            }
            buffer[i] = sample;
        }
        return buffer;
    }

    private applyDynamicsInPlace(buffer: Float32Array, dynamics: DynamicsSettings): Float32Array {
        let envelope = 0;
        const attack = 0.003;
        const release = 0.25;
        for (let i = 0; i < buffer.length; i++) {
            const inputLevel = Math.abs(buffer[i]);
            envelope += inputLevel > envelope ? attack * (inputLevel - envelope) : release * (inputLevel - envelope);
            const threshold = Math.pow(10, dynamics.threshold / 20);
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
}

registerProcessor('audio-worklet-processor', AudioProcessor);
export default '';
