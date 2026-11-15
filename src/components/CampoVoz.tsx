import { useId, useRef, useState } from 'react'

type Props = {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  listId?: string
}

// Web Speech API (quando existir) — tipagem mínima.
type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void
  onend: () => void
  onerror: () => void
  start: () => void
  stop: () => void
}

function criarReconhecimento(): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return Ctor ? new Ctor() : null
}

/** Campo de texto com ditado (Web Speech API ou microfone nativo do teclado iOS). */
export default function CampoVoz({
  label,
  value,
  onChange,
  placeholder,
  autoCapitalize = 'sentences',
  listId,
}: Props) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const [ouvindo, setOuvindo] = useState(false)

  function aoTocarMic() {
    const rec = criarReconhecimento()
    if (!rec) {
      // Sem Web Speech API: foca o campo para usar o mic do teclado iOS.
      inputRef.current?.focus()
      return
    }
    if (ouvindo) {
      recRef.current?.stop()
      return
    }
    rec.lang = 'pt-BR'
    rec.interimResults = false
    rec.continuous = false
    rec.onresult = (e) => {
      const txt = e.results[e.results.length - 1][0].transcript.trim()
      onChange(value ? `${value} ${txt}`.trim() : txt)
    }
    rec.onend = () => setOuvindo(false)
    rec.onerror = () => setOuvindo(false)
    recRef.current = rec
    setOuvindo(true)
    try {
      rec.start()
    } catch {
      setOuvindo(false)
    }
  }

  return (
    <div>
      <label htmlFor={id} className="rotulo">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          ref={inputRef}
          className="campo pr-14"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoCapitalize={autoCapitalize}
          list={listId}
          enterKeyHint="done"
        />
        <button
          type="button"
          onClick={aoTocarMic}
          aria-label="Ditar por voz"
          className={`absolute right-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full text-lg transition ${
            ouvindo ? 'bg-rose text-white animate-pulse' : 'bg-rose-soft/40 text-rose-deep'
          }`}
        >
          🎤
        </button>
      </div>
    </div>
  )
}
