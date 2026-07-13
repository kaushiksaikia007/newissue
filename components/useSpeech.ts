"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Text-to-speech via the browser's Web Speech API. Picks the highest-quality
// English voice available (neural/online voices when present), cleans markdown
// so the reading is accurate, and works around Chrome's ~15s cutoff for long
// messages. No network or API key required.

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const english = voices.filter((v) => /^en/i.test(v.lang));
  const pool = english.length ? english : voices;
  const score = (v: SpeechSynthesisVoice) => {
    const n = v.name.toLowerCase();
    let s = 0;
    if (/natural|neural|online/.test(n)) s += 100; // Microsoft/Edge neural voices
    if (n.includes("google")) s += 60;
    if (/^en-in/i.test(v.lang)) s += 45; // India English suits India-focused content
    else if (/^en-gb/i.test(v.lang)) s += 25;
    else if (/^en-us/i.test(v.lang)) s += 22;
    return s;
  };
  return [...pool].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Strip markdown/symbols so the voice reads the words, not the punctuation. */
function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ". code block. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SpeechController {
  supported: boolean;
  speakingId: string | null;
  speak: (id: string, text: string) => void;
  stop: () => void;
}

export function useSpeech(): SpeechController {
  const [supported, setSupported] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const keepAlive = useRef<ReturnType<typeof setInterval> | null>(null);
  const speakingIdRef = useRef<string | null>(null);

  const clearKeepAlive = () => {
    if (keepAlive.current) {
      clearInterval(keepAlive.current);
      keepAlive.current = null;
    }
  };

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    setSupported(true);
    const synth = window.speechSynthesis;
    const load = () => {
      voiceRef.current = pickVoice(synth.getVoices());
    };
    load();
    synth.addEventListener?.("voiceschanged", load);
    return () => {
      synth.removeEventListener?.("voiceschanged", load);
      synth.cancel();
      clearKeepAlive();
    };
  }, []);

  const setSpeaking = (id: string | null) => {
    speakingIdRef.current = id;
    setSpeakingId(id);
  };

  const stop = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    clearKeepAlive();
    setSpeaking(null);
  }, []);

  const speak = useCallback((id: string, text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const wasSame = speakingIdRef.current === id;

    synth.cancel();
    clearKeepAlive();
    if (wasSame) {
      setSpeaking(null); // clicking the active message stops it
      return;
    }

    const content = cleanForSpeech(text);
    if (!content) return;

    const utter = new SpeechSynthesisUtterance(content);
    if (voiceRef.current) {
      utter.voice = voiceRef.current;
      utter.lang = voiceRef.current.lang;
    }
    utter.rate = 1;
    utter.pitch = 1;
    utter.volume = 1;
    utter.onend = () => {
      clearKeepAlive();
      if (speakingIdRef.current === id) setSpeaking(null);
    };
    utter.onerror = utter.onend;

    setSpeaking(id);
    // cancel() then immediate speak() is dropped in some browsers — let it settle.
    setTimeout(() => {
      if (speakingIdRef.current !== id) return;
      synth.speak(utter);
      // Only long messages need the anti-cutoff keep-alive (it can glitch short ones).
      if (content.length > 200) {
        keepAlive.current = setInterval(() => {
          if (!synth.speaking) return;
          synth.pause();
          synth.resume();
        }, 9000);
      }
    }, 60);
  }, []);

  return { supported, speakingId, speak, stop };
}
