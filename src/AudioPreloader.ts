/**
 * AudioPreloader.ts
 *
 *  - Worker = 오디오 파일 다운로드
 *  - 메인 스레드 = decodeAudioData & AudioWorklet 재생
 *  - 멀티 트랙, 마스터 볼륨 & 로우패스 필터 적용
 */
import {
	AudioProcessorPostMessage,
	DriveSettings,
	DynamicsSettings,
	EffectsSettings,
	EQBand,
	ModulationSettings,
	VisualizerBand,
} from "./types";

export interface FileMap {
	[key: string]: string;
}

export class AudioPreloader {
	private worker: Worker;
	private audioDataMap = new Map<string, ArrayBuffer>();
	private audioBuffers = new Map<string, AudioBuffer>();

	private loadingProgress = 0;
	private loadedCount = 0;
	private totalCount = 0;
	public isWorkerDone = false;

	private audioContext: AudioContext;
	private audioWorkletNode: AudioWorkletNode | null = null;

	// 비주얼라이저 데이터를 처리할 콜백 함수
	private visualizerCallback: ((data: number[]) => void) | null = null;

	constructor(
		private baseUrl: string,
		private fileMap: FileMap,
		workerUrl: string,
		private fetchOptions?: RequestInit,
		private onWorkerMessage?: (type: string, payload: any) => void
	) {
		this.audioContext = new AudioContext();
		this.worker = new Worker(workerUrl);
		this.worker.onmessage = (e: MessageEvent) => {
			const { type, payload } = e.data;
			if (this.onWorkerMessage) {
				this.onWorkerMessage(type, payload);
			}
			switch (type) {
				case "PROGRESS":
					this.loadingProgress = payload.loadedCount / payload.total;
					this.loadedCount = payload.loadedCount;
					this.totalCount = payload.total;
					break;
				case "LOADED":
					this.audioDataMap.set(payload.key, payload.arrayBuffer);
					break;
				case "DONE":
					this.isWorkerDone = true;
					break;
				case "ERROR":
					// Worker에서는 payload에 fileName 대신 url을 전달하므로 수정
					console.error(
						`[Error] key=${payload.key}, file=${payload.url}, msg=${payload.message}`
					);
					break;
			}
		};
	}

	/**
	 * 모든 오디오 파일을 Worker를 통해 다운로드합니다.
	 * 다운로드 진행 상황은 onWorkerMessage 콜백을 통해 전달됩니다.
	 */
	public loadAll(): Promise<void> {
		return new Promise((resolve, reject) => {
			const fileCount = Object.keys(this.fileMap).length;
			if (fileCount === 0) {
				this.isWorkerDone = true;
				resolve();
				return;
			}

			this.worker.postMessage({
				type: "LOAD_AUDIO",
				payload: {
					baseUrl: this.baseUrl,
					fileMap: this.fileMap,
					fetchOptions: this.fetchOptions,
				},
			});
			const onMessage = (e: MessageEvent) => {
				const { type, payload } = e.data;
				if (type === "DONE") {
					this.worker.removeEventListener("message", onMessage);
					resolve();
				} else if (type === "ERROR") {
					this.worker.removeEventListener("message", onMessage);
					reject(payload.message);
				}
			};
			this.worker.addEventListener("message", onMessage);
		});
	}

	/**
	 * 다운로드한 오디오 데이터를 decodeAudioData()를 사용해 AudioBuffer로 디코딩합니다.
	 * 디코딩에 실패하면 무음 버퍼(silent buffer)를 생성합니다.
	 */
	public async decodeAll(): Promise<void> {
		const promises: Promise<void>[] = [];
		for (const [key, arrayBuf] of this.audioDataMap.entries()) {
			if (this.audioBuffers.has(key)) continue;
			const p = this.audioContext
				.decodeAudioData(arrayBuf.slice(0))
				.then((audioBuf) => {
					this.audioBuffers.set(key, audioBuf);
				})
				.catch((err) => {
					console.error(`[Decode fail] key=${key}`, err);
					// 실패 시 무음 버퍼 생성
					const silent = this.audioContext.createBuffer(
						1,
						this.audioContext.sampleRate,
						this.audioContext.sampleRate
					);
					this.audioBuffers.set(key, silent);
				});
			promises.push(p);
		}
		await Promise.all(promises);
	}

	/**
	 * AudioWorklet 모듈을 로드하고 AudioWorkletNode를 초기화합니다.
	 * AudioWorkletNode는 AudioContext의 destination에 연결됩니다.
	 * 비주얼라이저 데이터 등 메시지를 수신할 수 있습니다.
	 * @param moduleUrl - AudioWorklet 모듈 URL
	 */
	public async initAudioWorklet(moduleUrl: string) {
		await this.audioContext.audioWorklet.addModule(moduleUrl);
		this.audioWorkletNode = new AudioWorkletNode(
			this.audioContext,
			"audio-worklet-processor"
		);
		this.audioWorkletNode.connect(this.audioContext.destination);

		this.audioWorkletNode.port.onmessage = (event) => {
			const { type, key, data } = event.data;
			if (type === "latencyReport") {
				console.log(
					`[Latency Report] Track=${key}, Latency=${
						data?.latency ?? "Unknown"
					}`
				);
			} else if (type === "visualizerData") {
				// 비주얼라이저 데이터 수신: 등록된 콜백이 있으면 호출합니다.
				if (this.visualizerCallback) {
					this.visualizerCallback(data);
				}
			}
		};
	}

	/**
	 * 비주얼라이저 데이터를 실시간으로 수신할 콜백 함수를 등록합니다.
	 * @param callback - 각 비주얼라이저 업데이트마다 호출되는 콜백 함수 (대역별 레벨 배열을 인자로 받음)
	 */
	public setVisualizerDataHandler(callback: (data: number[]) => void): void {
		this.visualizerCallback = callback;
	}

	/**
	 * 지정된 키의 오디오 트랙을 재생합니다.
	 * 재생 시 loop 여부와 playbackRate(재생 배속)를 지정할 수 있습니다.
	 * @param key - 오디오 트랙을 식별하는 고유 키
	 * @param loop - 반복 재생 여부 (기본값: false)
	 * @param playbackRate - 재생 배속 (기본값: 1)
	 */
	public playAudio(key: string, loop = false, playbackRate = 1) {
		if (!this.audioWorkletNode) {
			console.error("AudioWorkletNode not initialized.");
			return;
		}
		const audioBuffer = this.audioBuffers.get(key);
		if (!audioBuffer) {
			console.warn(`No AudioBuffer for key=${key}`);
			return;
		}
		if (this.audioContext.state === "suspended") {
			this.audioContext.resume();
		}

		// AudioBuffer의 첫 채널 데이터를 가져와 Float32Array로 변환합니다.
		const float32Data = audioBuffer.getChannelData(0).slice(0);

		// 재생 배속(playbackRate) 기능이 추가되었으므로 데이터를 함께 전송합니다.
		this.postTypedMessage<AudioProcessorPostMessage>({
			type: "play",
			key,
			data: { buffer: float32Data, loop, playbackRate },
		});
	}

	/**
	 * 재생 중인 트랙의 배속(playback rate)을 동적으로 조절합니다.
	 * @param key - 트랙을 식별하는 고유 키
	 * @param rate - 적용할 재생 배속 (예: 1은 기본, 2는 2배속, 0.5는 반속)
	 */
	public adjustPlaybackRate(key: string, rate: number) {
		this.postTypedMessage({ type: "adjustPlaybackRate", key, data: rate });
	}

	/**
	 * 재생 중인 트랙의 노멀라이즈 기능을 활성화 또는 비활성화합니다.
	 * @param key - 트랙을 식별하는 고유 키
	 * @param flag - true: 활성화, false: 비활성화
	 */
	public adjustNormalize(key: string, flag: boolean) {
		this.postTypedMessage({ type: "adjustNormalize", key, data: flag });
	}

	/**
	 * 재생 중인 트랙의 출력 레이턴시(지연)를 조절합니다.
	 * @param key - 트랙을 식별하는 고유 키
	 * @param ms - 지연 시간 (밀리초 단위)
	 */
	public adjustLatency(key: string, ms: number) {
		this.postTypedMessage({ type: "adjustLatency", key, data: ms });
	}

	/**
	 * 재생 중인 트랙의 출력 레이턴시(지연)를 샘플 단위로 조절합니다.
	 * @param key - 트랙을 식별하는 고유 키
	 * @param samples - 지연 샘플 수 (0 ~ sampleRate, 최대 1초)
	 */
	public adjustLatencySamples(key: string, samples: number) {
		this.postTypedMessage({ type: "adjustLatencySamples", key, data: samples });
	}

	/**
	 * 비주얼라이저 대역(VisualizerBand[])을 설정합니다.
	 * @param key - 트랙과 관계없이 전역적으로 설정 (빈 문자열을 전달해도 됨)
	 * @param bands - VisualizerBand 객체 배열 (각 객체는 startFrequency와 endFrequency 속성을 가짐)
	 */
	public setVisualizerBands(key: string, bands: VisualizerBand[]) {
		this.postTypedMessage({ type: "setVisualizerBands", key, data: bands });
	}

	/**
	 * 재생 중인 트랙의 볼륨을 조절합니다.
	 * (개별 트랙 볼륨 조절)
	 * @param key - 트랙을 식별하는 고유 키
	 * @param volume - 적용할 볼륨 값 (0.0 ~ 1.0)
	 */
	public adjustVolume(key: string, volume: number) {
		this.postTypedMessage({ type: "adjustVolume", key, data: volume });
	}

	/**
	 * 재생 중인 트랙에 적용할 이퀄라이저(EQ) 설정을 조절합니다.
	 * @param key - 트랙을 식별하는 고유 키
	 * @param bandSettings - EQ 밴드 설정 배열 (각 밴드의 주파수와 게인 값 포함)
	 */
	public adjustEQ(key: string, bandSettings: EQBand[]) {
		this.postTypedMessage({ type: "adjustEQ", key, data: bandSettings });
	}

	/**
	 * 재생 중인 트랙의 모듈레이션 설정을 조절합니다.
	 * @param key - 트랙을 식별하는 고유 키
	 * @param settings - 모듈레이션 설정 (예: 타입, 깊이(depth), 속도(rate) 등)
	 */
	public adjustModulation(key: string, settings: ModulationSettings) {
		this.postTypedMessage({
			type: "adjustModulation",
			key,
			data: settings,
		});
	}

	/**
	 * 재생 중인 트랙에 적용할 이펙트(Delay, Reverb, Echo 등) 설정을 조절합니다.
	 * @param key - 트랙을 식별하는 고유 키
	 * @param settings - 이펙트 설정 객체 (delay, reverb, echo, loop 등의 속성을 포함)
	 */
	public adjustEffects(key: string, settings: EffectsSettings) {
		this.postTypedMessage({ type: "adjustEffects", key, data: settings });
	}

	/**
	 * 재생 중인 트랙에 적용할 드라이브(디스토션, 오버드라이브, 퍼즈 등) 설정을 조절합니다.
	 * @param key - 트랙을 식별하는 고유 키
	 * @param settings - 드라이브 설정 객체 (distortion, overdrive, fuzz 등의 속성을 포함)
	 */
	public adjustDrive(key: string, settings: DriveSettings) {
		this.postTypedMessage({ type: "adjustDrive", key, data: settings });
	}

	/**
	 * 재생 중인 트랙에 적용할 다이나믹스(컴프레션 등) 설정을 조절합니다.
	 * @param key - 트랙을 식별하는 고유 키
	 * @param settings - 다이나믹스 설정 객체 (threshold, ratio 등의 속성을 포함)
	 */
	public adjustDynamics(key: string, settings: DynamicsSettings) {
		this.postTypedMessage({ type: "adjustDynamics", key, data: settings });
	}

	/**
	 * 재생 중인 특정 트랙을 정지시킵니다.
	 * @param key - 정지시킬 트랙의 고유 키
	 */
	public stopAudio(key: string): void {
		this.postTypedMessage({ type: "stop", key, data: null });
	}

	/**
	 * 특정 트랙의 데이터를 메모리에서 제거합니다.
	 * (예: 재생 종료 후 리소스 정리)
	 * @param key - 제거할 트랙의 고유 키
	 */
	public clearAudio(key: string): void {
		this.postTypedMessage({ type: "clear", key, data: null });
	}

	/**
	 * 전체(마스터) 볼륨을 조절합니다.
	 * AudioWorkletProcessor에서 마스터 볼륨 조절을 지원하는 경우 사용합니다.
	 * @param volume - 0.0 ~ 1.0 사이의 값
	 */
	public setMasterVolume(volume: number): void {
		// key가 빈 문자열('')이면 전역 설정으로 처리하도록 합니다.
		this.postTypedMessage({
			type: "adjustMasterVolume",
			key: "",
			data: volume,
		});
	}

	/**
	 * 로우패스 필터(low-pass filter) 설정을 적용합니다.
	 * AudioWorkletProcessor에서 로우패스 필터 처리를 지원하는 경우 사용합니다.
	 * @param cutoff - 컷오프 주파수 (Hz)
	 * @param Q - 필터의 Q 값 (품질 계수)
	 */
	public setLowPassFilter(cutoff: number, Q: number): void {
		// key가 빈 문자열('')이면 전역 설정으로 처리하도록 합니다.
		this.postTypedMessage({
			type: "setLowPassFilter",
			key: "",
			data: { cutoff, Q },
		});
	}

	/**
	 * AudioWorkletProcessor의 비주얼라이저 버퍼 크기를 설정합니다.
	 * @param bufferSize - 32부터 1024 사이의 정수 값 (샘플 수)
	 */
	public setVisualizerBufferSize(bufferSize: number): void {
		if (!this.audioWorkletNode) {
			console.error("AudioWorkletNode not initialized.");
			return;
		}
		if (
			!Number.isInteger(bufferSize) ||
			bufferSize < 32 ||
			bufferSize > 1024
		) {
			console.error(
				"Visualizer buffer size must be an integer between 32 and 1024."
			);
			return;
		}
		this.postTypedMessage({
			type: "setVisualizerBufferSize",
			key: "",
			data: bufferSize,
		});
	}

	/**
	 * AudioContext를 재개(resume)합니다.
	 * (일부 브라우저에서는 사용자 제스처 없이 자동으로 resume 되지 않으므로, 재개가 필요할 수 있음)
	 */
	public resumeContext(): Promise<void> {
		return this.audioContext.resume();
	}

	/**
	 * AudioContext를 일시 중지(suspend)합니다.
	 * (필요한 경우 배터리 절약이나 리소스 관리 목적 등으로 사용)
	 */
	public suspendContext(): Promise<void> {
		return this.audioContext.suspend();
	}

	/**
	 * AudioWorkletNode의 포트를 통해 메시지를 전송합니다.
	 * @param message - 전송할 메시지 객체
	 * @param options - (선택) StructuredSerializeOptions
	 */
	private postTypedMessage<T>(
		message: T,
		options?: StructuredSerializeOptions
	): void {
		if (!this.audioWorkletNode) {
			console.error("AudioWorkletNode not initialized.");
			return;
		}
		this.audioWorkletNode.port.postMessage(message, options);
	}

	/**
	 * 모든 다운로드, 디코딩된 오디오 데이터를 메모리에서 해제하고,
	 * AudioContext를 종료합니다.
	 */
	public releaseAllResources(): void {
		this.audioDataMap.clear();
		this.audioBuffers.clear();
		if (this.audioContext.state !== "closed") {
			this.audioContext.close();
		}
		console.log("[Main] All resources released.");
	}

	// 게터 (getter) 함수들: 다운로드 및 로딩 진행 상황을 확인할 수 있습니다.
	public get progress() {
		return this.loadingProgress;
	}
	public get downloadedCount() {
		return this.loadedCount;
	}
	public get downloadedTotal() {
		return this.totalCount;
	}
	public get loaded() {
		return this.isWorkerDone;
	}
}
