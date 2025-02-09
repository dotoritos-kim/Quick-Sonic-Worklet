declare const sampleRate: number;
declare class AudioWorkletProcessor {
	readonly port: MessagePort;
	constructor();
	process(
		inputs: Float32Array[][],
		outputs: Float32Array[][],
		parameters: Record<string, Float32Array>
	): boolean;
}
declare function registerProcessor(
	name: string,
	processorCtor: typeof AudioWorkletProcessor
): void;
declare module "*.worklet" {
	const exportString: string;
	export default exportString;
}
declare module "*.worklet.ts" {
	const url: string;
	export default url;
}
