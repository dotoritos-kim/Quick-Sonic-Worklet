# Quick-Sonic-Worklet Library

Quick-Sonic-Worklet is a TypeScript library designed to streamline the downloading, decoding, and playback of audio files using Web Workers and AudioWorklet. It supports multi-track playback, master volume control, and professional-grade audio effects.

## Features

-   **Worker-based Audio Downloading**: Offload audio file downloads to a Web Worker for efficient background processing.
-   **Main Thread Decoding & Playback**: Use `decodeAudioData` and `AudioWorklet` for high-performance audio decoding and playback.
-   **Multi-Track Support**: Play multiple audio tracks simultaneously with individual controls.
-   **Professional Audio Effects**: EQ, modulation (chorus/flanger/vibrato), Schroeder reverb, delay, echo, drive, and dynamics.
-   **Real-time Parameter Control**: All effects can be adjusted in real-time during playback.
-   **Visualizer Integration**: Real-time visualizer data handling for audio visualization.
-   **Master Volume & Low-Pass Filter**: Control overall volume and apply global audio filters.

## Installation

```bash
npm install quick-sonic-worklet
```

## Usage

### Importing the Library

```typescript
import { AudioPreloader } from "./AudioPreloader";
import { AudioLoadWorker } from "./AudioLoader.worker";
```

### Initialization

```typescript
const fileMap = {
	track1: "audio/track1.mp3",
	track2: "audio/track2.mp3",
};

const preloader = new AudioPreloader(
	"https://example.com/",
	fileMap,
	AudioLoadWorker
);
```

### Loading and Decoding Audio

```typescript
await preloader.loadAll();
await preloader.decodeAll();
await preloader.initAudioWorklet(workletUrl);
```

### Playing Audio

```typescript
preloader.playAudio("track1", true, 1.5);  // loop, 1.5x speed
preloader.adjustVolume("track1", 0.8);
preloader.stopAudio("track1");
```

## Audio Effects

### EQ (Equalizer)

```typescript
preloader.adjustEQ("track1", [
	{ frequency: 60, gain: 5 },      // Bass boost (+5dB)
	{ frequency: 1000, gain: -3 },   // Mid cut (-3dB)
	{ frequency: 8000, gain: 2 },    // Treble boost (+2dB)
]);
```

### Modulation Effects

| Type | Description |
|------|-------------|
| `chorus` | Rich, layered sound with delayed signal |
| `flanger` | Jet-like sweeping effect |
| `vibrato` | Pitch modulation |
| `tremolo` | Amplitude modulation |
| `ring` | Ring modulation |
| `square` / `triangle` / `sawtooth` | Waveform-based modulation |

```typescript
preloader.adjustModulation("track1", {
	type: "chorus",   // Modulation type
	depth: 0.5,       // 0.0 ~ 1.0
	rate: 2.0         // Hz
});
```

### Reverb (Schroeder Reverb)

#### Using Presets

| Preset | Decay | Diffusion | Description |
|--------|-------|-----------|-------------|
| `small` | 0.70 | 0.40 | Small room |
| `medium` | 0.80 | 0.50 | Medium room |
| `large` | 0.85 | 0.55 | Large room |
| `hall` | 0.90 | 0.60 | Concert hall |
| `plate` | 0.88 | 0.70 | Plate reverb |
| `cathedral` | 0.95 | 0.65 | Cathedral |

```typescript
preloader.adjustEffects("track1", {
	reverb: 0.5,        // Wet/dry mix (0~1)
	roomSize: "hall"    // Preset
});
```

#### Custom Parameters

```typescript
preloader.adjustEffects("track1", {
	reverb: 0.5,
	reverbDecay: 0.9,      // Decay time (0~1)
	reverbDiffusion: 0.6   // Diffusion (0~1)
});
```

### Delay & Echo

```typescript
preloader.adjustEffects("track1", {
	delay: 300,   // Delay time in ms (0~2000)
	echo: 200     // Echo time in ms (0~1000, multi-tap)
});
```

### Drive Effects

```typescript
preloader.adjustDrive("track1", {
	distortion: 0.5,   // Hard clipping (0~1)
	overdrive: 0.3,    // Soft clipping (0~1)
	fuzz: 0.7          // Asymmetric clipping + harmonics (0~1)
});
```

### Dynamics (Compressor)

```typescript
preloader.adjustDynamics("track1", {
	threshold: -24,   // dB (-60 ~ 0)
	ratio: 4          // Compression ratio (1 ~ 20)
});
```

### Latency Control

```typescript
preloader.adjustLatency("track1", 50);         // 50ms delay
preloader.adjustLatencySamples("track1", 2400); // 2400 samples delay
```

## Visualizer

```typescript
preloader.setVisualizerDataHandler((data) => {
	console.log("Band levels:", data);
});

preloader.setVisualizerBands("", [
	{ startFrequency: 20, endFrequency: 200 },
	{ startFrequency: 200, endFrequency: 2000 },
	{ startFrequency: 2000, endFrequency: 20000 },
]);

preloader.setVisualizerBufferSize(256);  // 32~1024
```

## API Reference

### Methods

| Method | Description |
|--------|-------------|
| `loadAll()` | Download all audio files |
| `decodeAll()` | Decode all downloaded audio |
| `initAudioWorklet(url)` | Initialize AudioWorklet |
| `playAudio(key, loop?, rate?)` | Play a track |
| `stopAudio(key)` | Stop a track |
| `clearAudio(key)` | Remove track from memory |
| `adjustVolume(key, volume)` | Set track volume (0~1) |
| `adjustEQ(key, bands)` | Apply EQ settings |
| `adjustModulation(key, settings)` | Apply modulation |
| `adjustEffects(key, settings)` | Apply delay/reverb/echo |
| `adjustDrive(key, settings)` | Apply drive effects |
| `adjustDynamics(key, settings)` | Apply compression |
| `adjustLatency(key, ms)` | Set latency in ms |
| `adjustLatencySamples(key, samples)` | Set latency in samples |
| `adjustNormalize(key, flag)` | Enable/disable normalization |
| `setMasterVolume(volume)` | Set master volume |
| `setLowPassFilter(cutoff, Q)` | Apply low-pass filter |
| `setVisualizerDataHandler(callback)` | Set visualizer callback |
| `setVisualizerBands(key, bands)` | Configure visualizer bands |
| `setVisualizerBufferSize(size)` | Set FFT buffer size |
| `resumeContext()` | Resume AudioContext |
| `suspendContext()` | Suspend AudioContext |
| `releaseAllResources()` | Release all resources |

### Properties

| Property | Description |
|----------|-------------|
| `progress` | Loading progress (0~1) |
| `downloadedCount` | Downloaded file count |
| `downloadedTotal` | Total file count |
| `loaded` | All files loaded |

## License

MIT License

