# Quick-Sonic-Worklet Library

Quick-Sonic-Worklet is a TypeScript library designed to streamline the downloading, decoding, and playback of audio files using Web Workers and AudioWorklet. It supports multi-track playback, master volume control, and audio effects like low-pass filters.

## Features

-   **Worker-based Audio Downloading**: Offload audio file downloads to a Web Worker for efficient background processing.
-   **Main Thread Decoding & Playback**: Use `decodeAudioData` and `AudioWorklet` for high-performance audio decoding and playback.
-   **Multi-Track Support**: Play multiple audio tracks simultaneously with individual controls.
-   **Audio Effects**: Apply effects such as EQ, modulation, delay, reverb, drive (distortion/overdrive), and dynamics (compression).
-   **Visualizer Integration**: Real-time visualizer data handling for audio visualization.
-   **Master Volume & Low-Pass Filter**: Control overall volume and apply global audio filters.

## Installation

Clone the repository or install via npm (if published).

```bash
npm install quick-sonic-worklet
```

## Usage

### Importing the Library

```typescript
import { AudioPreloader } from "./AudioPreloader";
```

### Initialization

```typescript
import { AudioLoadWorker } from "./AudioLoader.worker";

const fileMap = {
	track1: "audio/track1.mp3",
	track2: "audio/track2.mp3",
};
const Callback: ((type: string, payload: any) => void) | undefined;

const preloader = new AudioPreloader(
	removeFileName(options.baseUrl), // This is the top address host such as https, http, etc. example: "https://localhost/"
	options.fileMap, // FileName list
	AudioLoadWorker,
	Callback
);
```

### Loading and Decoding Audio

```typescript
// Load audio files via Worker
await preloader.loadAll();

// Decode audio data to AudioBuffers
await preloader.decodeAll();
```

### Initializing AudioWorklet

```typescript
await this._audioPreloader.initAudioWorklet(""); // optional
```

### Playing Audio

```typescript
// Play track1 with loop and 1.5x speed
preloader.playAudio("track1", true, 1.5);

// Adjust volume of track1
preloader.adjustVolume("track1", 0.8);

// Stop track1
preloader.stopAudio("track1");
```

### Applying Effects

```typescript
// Apply EQ settings
preloader.adjustEQ("track1", [
	{ frequency: 60, gain: 5 },
	{ frequency: 1000, gain: -3 },
]);

// Apply modulation
preloader.adjustModulation("track1", { type: "chorus", depth: 0.7, rate: 1.2 });

// Apply reverb effect
preloader.adjustEffects("track1", { reverb: 0.5 });
```

### Visualizer Data Handling

```typescript
preloader.setVisualizerDataHandler((data) => {
	console.log("Visualizer data:", data);
});

// Set visualizer bands
preloader.setVisualizerBands("", [
	{ startFrequency: 20, endFrequency: 200 },
	{ startFrequency: 201, endFrequency: 2000 },
]);
```

### Global Controls

```typescript
// Set master volume
preloader.setMasterVolume(0.9);

// Apply low-pass filter
preloader.setLowPassFilter(800, 1);
```

### Resource Management

```typescript
// Suspend and resume audio context
await preloader.suspendContext();
await preloader.resumeContext();

// Release all resources
preloader.releaseAllResources();
```

## API Reference

### Constructor

```typescript
new AudioPreloader(baseUrl: string, fileMap: FileMap, workerUrl: string, fetchOptions?: RequestInit, onWorkerMessage?: (type: string, payload: any) => void)
```

### Methods

-   `loadAll(): Promise<void>` - Downloads all audio files.
-   `decodeAll(): Promise<void>` - Decodes all downloaded audio data.
-   `initAudioWorklet(moduleUrl: string): Promise<void>` - Initializes the AudioWorklet.
-   `playAudio(key: string, loop?: boolean, playbackRate?: number)` - Plays an audio track.
-   `stopAudio(key: string)` - Stops an audio track.
-   `adjustVolume(key: string, volume: number)` - Adjusts the volume of a track.
-   `adjustEQ(key: string, bandSettings: EQBand[])` - Applies EQ settings.
-   `adjustModulation(key: string, settings: ModulationSettings)` - Applies modulation effects.
-   `adjustEffects(key: string, settings: EffectsSettings)` - Applies audio effects.
-   `setVisualizerDataHandler(callback: (data: number[]) => void)` - Sets the visualizer data handler.
-   `setMasterVolume(volume: number)` - Sets the master volume.
-   `setLowPassFilter(cutoff: number, Q: number)` - Applies a low-pass filter.
-   `releaseAllResources()` - Releases all resources and closes the AudioContext.

### Properties

-   `progress: number` - Returns the current loading progress.
-   `downloadedCount: number` - Number of downloaded files.
-   `downloadedTotal: number` - Total number of files to download.
-   `loaded: boolean` - Indicates if all files are loaded.

## License

MIT License

---

For more details, refer to the source code and comments in `AudioPreloader.ts`.
