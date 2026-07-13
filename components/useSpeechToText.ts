"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Speech-to-text via the browser's Web Speech Recognition API (Chrome/Edge/
// Safari). Streams interim results for live feedback and keeps listening until
// the user stops. Setting the right locale (e.g. en-IN) sharpens accuracy.

interface SRAlternative {
  transcript: string;
  confidence: number;
}
interface SRResult {
  0: SRAlternative;
  isFinal: boolean;
  length: number;
}
interface SRResultList {
  length: number;
  [index: number]: SRResult;
}
interface SREvent {
  resultIndex: number;
  results: SRResultList;
}
interface SRErrorEvent {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface DictationController {
  supported: boolean;
  listening: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
}

export function useSpeechToText(opts: {
  lang?: string;
  onResult: (transcript: string, isFinal: boolean) => void;
}): DictationController {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const onResultRef = useRef(opts.onResult);
  const langRef = useRef(opts.lang ?? "en-US");

  // Keep the latest callback / lang without re-creating the recognizer.
  onResultRef.current = opts.onResult;
  langRef.current = opts.lang ?? "en-US";

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
    return () => {
      try {
        recogRef.current?.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const stop = useCallback(() => {
    try {
      recogRef.current?.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || listening) return;

    const recog = new Ctor();
    recog.lang = langRef.current;
    recog.continuous = true;
    recog.interimResults = true;
    recog.maxAlternatives = 1;

    recog.onresult = (e: SREvent) => {
      let transcript = "";
      let isFinal = false;
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
        if (e.results[i].isFinal) isFinal = true;
      }
      onResultRef.current(transcript.trim(), isFinal);
    };
    recog.onerror = (e: SRErrorEvent) => {
      setError(e.error || "speech error");
      setListening(false);
    };
    recog.onend = () => setListening(false);

    recogRef.current = recog;
    setError(null);
    try {
      recog.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [listening]);

  return { supported, listening, error, start, stop };
}
