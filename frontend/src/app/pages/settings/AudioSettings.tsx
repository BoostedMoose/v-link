import { useEffect, useRef, useState } from 'react';
import styled, { useTheme } from 'styled-components';

import CustomSlider from '@/app/components/CustomSlider';
import { Button, ToggleSwitch } from '@/theme/styles/Inputs';
import { useThemeColor } from '@/store/Store';
import { DEFAULT_AUDIO_SETTINGS, type AudioSettingsValues } from './audioSettingsState';

const Page = styled.div`display:flex;flex-direction:column;gap:10px;padding-bottom:24px;color:${({ theme }) => theme.colors.text};`;
const Heading = styled.h2`margin:8px 0 10px;color:${({ theme }) => theme.colors.light};font-family:${({ theme }) => theme.fonts.spartan};`;
const Section = styled.section`display:flex;flex-direction:column;gap:8px;margin-bottom:14px;`;
const SectionTitle = styled.h3`margin:4px 0;color:${({ theme }) => theme.colors.light};font:600 16px ${({ theme }) => theme.fonts.inter};`;
const Row = styled.div`min-height:48px;display:grid;grid-template-columns:minmax(190px,1fr) minmax(220px,40%) 58px;align-items:center;gap:14px;border-bottom:1px solid ${({ theme }) => theme.colors.dark};font-family:${({ theme }) => theme.fonts.inter};`;
const Fixed = styled.span`justify-self:end;color:${({ theme }) => theme.colors.medium};`;
const Meter = styled.div`height:10px;overflow:hidden;border-radius:5px;background:${({ theme }) => theme.colors.dark};`;
const MeterFill = styled.div<{ $level: number; $clipping: boolean }>`height:100%;width:${({ $level }) => `${$level}%`};background:${({ $clipping, theme }) => $clipping ? '#e64b4b' : theme.colors.theme.white.active};transition:width 70ms linear;`;
const Help = styled.p<{ $error?: boolean }>`margin:0;color:${({ $error, theme }) => $error ? '#e64b4b' : theme.colors.medium};font:12px/1.45 ${({ theme }) => theme.fonts.inter};`;
const Actions = styled.div`display:flex;align-items:center;gap:12px;`;
const ToggleRow = styled.div`min-height:48px;display:flex;align-items:center;justify-content:space-between;gap:14px;border-bottom:1px solid ${({ theme }) => theme.colors.dark};font-family:${({ theme }) => theme.fonts.inter};`;
const ToggleCopy = styled.div`display:flex;flex-direction:column;gap:2px;`;

type NumericAudioSetting = {
  [Key in keyof AudioSettingsValues]: AudioSettingsValues[Key] extends number ? Key : never;
}[keyof AudioSettingsValues];

type MicrophoneTestStatus = 'idle' | 'starting' | 'testing' | 'error';

type MicrophoneTestResources = {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
};

const MICROPHONE_START_TIMEOUT_MS = 10_000;

const releaseTestResources = (resources: MicrophoneTestResources | null) => {
  if (!resources) return;
  resources.source.disconnect();
  resources.gain.disconnect();
  resources.analyser.disconnect();
  resources.stream.getTracks().forEach((track) => track.stop());
  if (resources.context.state !== 'closed') {
    void resources.context.close().catch((error) => console.warn('Failed to close microphone test AudioContext', error));
  }
};

const describeMicrophoneError = (error: unknown) => {
  if (error && typeof error === 'object' && 'name' in error && 'message' in error) {
    return `${String(error.name)}: ${String(error.message)}`;
  }
  return `Microphone test failed: ${String(error)}`;
};

interface AudioSettingsProps {
  values: AudioSettingsValues;
  onChange: (values: AudioSettingsValues) => void;
}

const AudioSettings = ({ values, onChange }: AudioSettingsProps) => {
  const [testStatus, setTestStatus] = useState<MicrophoneTestStatus>('idle');
  const [testError, setTestError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const resourcesRef = useRef<MicrophoneTestResources | null>(null);
  const animationRef = useRef<number | null>(null);
  const startTimeoutRef = useRef<number | null>(null);
  const testRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const theme = useTheme();
  const themeColor = useThemeColor();

  useEffect(() => () => {
    mountedRef.current = false;
    testRequestRef.current += 1;
    if (startTimeoutRef.current != null) window.clearTimeout(startTimeoutRef.current);
    if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
    releaseTestResources(resourcesRef.current);
    resourcesRef.current = null;
  }, []);

  const update = <Key extends keyof AudioSettingsValues>(key: Key, value: AudioSettingsValues[Key]) => {
    const next = { ...values, [key]: value };
    onChange(next);
  };

  const stopTest = () => {
    testRequestRef.current += 1;
    if (startTimeoutRef.current != null) window.clearTimeout(startTimeoutRef.current);
    startTimeoutRef.current = null;
    if (animationRef.current != null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    releaseTestResources(resourcesRef.current);
    resourcesRef.current = null;
    setTestStatus('idle');
    setTestError(null);
    setLevel(0);
  };

  const startTest = async () => {
    const requestId = testRequestRef.current + 1;
    testRequestRef.current = requestId;
    releaseTestResources(resourcesRef.current);
    resourcesRef.current = null;
    setLevel(0);
    setTestError(null);
    setTestStatus('starting');

    startTimeoutRef.current = window.setTimeout(() => {
      if (!mountedRef.current || testRequestRef.current !== requestId) return;
      testRequestRef.current += 1;
      startTimeoutRef.current = null;
      setTestStatus('error');
      setTestError('TimeoutError: Chromium did not finish opening the microphone within 10 seconds. The device may already be in use.');
    }, MICROPHONE_START_TIMEOUT_MS);

    let stream: MediaStream | null = null;
    let resources: MicrophoneTestResources | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is not available in this browser');
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current || testRequestRef.current !== requestId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const context = new AudioContext();
      const analyser = context.createAnalyser();
      const gain = context.createGain();
      const source = context.createMediaStreamSource(stream);
      gain.gain.value = 10 ** (values.microphoneGainDb / 20);
      source.connect(gain).connect(analyser);
      analyser.fftSize = 1024;
      const samples = new Uint8Array(analyser.fftSize);
      resources = { stream, context, source, gain, analyser };

      if (!mountedRef.current || testRequestRef.current !== requestId) {
        releaseTestResources(resources);
        return;
      }

      resourcesRef.current = resources;
      if (startTimeoutRef.current != null) window.clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = null;
      setTestStatus('testing');
      const measure = () => {
        if (!mountedRef.current || testRequestRef.current !== requestId) return;
        analyser.getByteTimeDomainData(samples);
        let peak = 0;
        samples.forEach((sample) => { peak = Math.max(peak, Math.abs(sample - 128) / 128); });
        setLevel(Math.min(peak * 1.4, 1) * 100);
        animationRef.current = requestAnimationFrame(measure);
      };
      measure();
    } catch (error) {
      if (startTimeoutRef.current != null) window.clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = null;
      if (resources) {
        releaseTestResources(resources);
      } else {
        stream?.getTracks().forEach((track) => track.stop());
      }
      if (!mountedRef.current || testRequestRef.current !== requestId) return;
      resourcesRef.current = null;
      setLevel(0);
      setTestStatus('error');
      setTestError(describeMicrophoneError(error));
    }
  };

  const slider = (label: string, key: NumericAudioSetting, min = 0, max = 100, unit = '%') => (
    <Row>
      <span>{label}</span>
      <CustomSlider value={values[key]} min={min} max={max} step={1} onChange={(event) => update(key, Number(event.target.value))} width="100%" backgroundColor={theme.colors.medium} defaultColor={theme.colors.theme[themeColor].default} activeColor={theme.colors.theme[themeColor].active} />
      <Fixed>{values[key]}{unit}</Fixed>
    </Row>
  );

  return (
    <Page>
      <Heading>Audio Settings</Heading>
      <Section>
        <SectionTitle>Local media</SectionTitle>
        <ToggleRow>
          <ToggleCopy>
            <span>Play local media on startup</span>
          </ToggleCopy>
          <ToggleSwitch
            backgroundColor={theme.colors.medium}
            defaultColor={theme.colors.theme[themeColor].default}
            activeColor={theme.colors.theme[themeColor].active}
          >
            <input
              type="checkbox"
              aria-label="Play local media on startup"
              checked={values.autoplayLocalMedia}
              onChange={(event) => update('autoplayLocalMedia', event.target.checked)}
            />
            <span className="slider" />
          </ToggleSwitch>
        </ToggleRow>
      </Section>
      <Section>
        <SectionTitle>Output</SectionTitle>
        {slider('Navigation instructions', 'navigationVolume')}
        {slider('Phone calls', 'callVolume')}
      </Section>
      <Section>
        <SectionTitle>Ducking</SectionTitle>
        {slider('Navigation ducking intensity', 'navigationDuckingAmount', 0, 100)}
      </Section>
      <Section>
        <SectionTitle>Call microphone</SectionTitle>
        {slider('Microphone input gain', 'microphoneGainDb', -20, 2, ' dB')}
        <Meter aria-label="Microphone level"><MeterFill $level={level} $clipping={level > 92} /></Meter>
        <div aria-live="polite">
          {testStatus === 'starting' && <Help>Starting microphone test…</Help>}
          {testStatus === 'testing' && <Help>{level > 92 ? 'Input is clipping. Reduce microphone gain.' : 'Speak normally; occasional peaks around 75% are ideal.'}</Help>}
          {testStatus === 'error' && testError && <Help $error>{testError}</Help>}
        </div>
        <Actions>
          <Button type="button" onClick={() => testStatus === 'starting' || testStatus === 'testing' ? stopTest() : void startTest()}>
            {testStatus === 'starting' ? 'Cancel microphone test' : testStatus === 'testing' ? 'Stop microphone test' : testStatus === 'error' ? 'Retry microphone test' : 'Test microphone'}
          </Button>
          <Button type="button" onClick={() => onChange(DEFAULT_AUDIO_SETTINGS)}>Restore defaults</Button>
        </Actions>
      </Section>
    </Page>
  );
};

export default AudioSettings;
