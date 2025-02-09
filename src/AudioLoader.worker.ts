export function AudioLoaderWorker() {
	interface FileMap {
		[key: string]: string;
	}

	/**
	 * 주어진 URL에서 음원 데이터를 가져옵니다.
	 * @param url 음원 파일 URL
	 * @param options fetch 옵션 (기본값: { cache: "force-cache" })
	 * @returns ArrayBuffer
	 */
	async function loadAudioFile(
		url: string,
		options: RequestInit = { cache: "force-cache" }
	): Promise<ArrayBuffer> {
		const response = await fetch(url, options);
		if (!response.ok) {
			throw new Error(`HTTP error ${response.status}`);
		}
		return response.arrayBuffer();
	}

	// Worker 메시지 핸들러
	self.onmessage = async (event: MessageEvent) => {
		const { type, payload } = event.data;
		if (type === "LOAD_AUDIO") {
			const { fileMap, fetchOptions } = payload as {
				fileMap: FileMap;
				fetchOptions?: RequestInit;
			};
			const entries = Object.entries(fileMap);
			const total = entries.length;
			let loadedCount = 0;

			for (const [key, url] of entries) {
				try {
					const arrayBuffer = await loadAudioFile(url, fetchOptions);
					loadedCount++;

					// 진행 상황 전송
					self.postMessage({
						type: "PROGRESS",
						payload: { key, url, loadedCount, total },
					});

					// ArrayBuffer 전송 (transferable 객체 사용)
					self.postMessage(
						{
							type: "LOADED",
							payload: { key, url, arrayBuffer },
						},
						[arrayBuffer]
					);
				} catch (error) {
					console.error(
						`[Worker] Audio load fail: key=${key}, url=${url}, error=${error}`
					);
					self.postMessage({
						type: "ERROR",
						payload: { key, url, message: String(error) },
					});
				}
			}

			// 모든 파일 로딩 완료 알림 전송
			self.postMessage({
				type: "DONE",
				payload: { total },
			});
		}
	};
}

// Worker 코드를 문자열로 변환 후 Blob 생성 예시
let code = AudioLoaderWorker.toString();
code = code.substring(code.indexOf("{") + 1, code.lastIndexOf("}"));

const blob = new Blob([code], { type: "application/javascript" });
const blobUrl = URL.createObjectURL(blob);
export { blobUrl as AudioLoadWorker };
