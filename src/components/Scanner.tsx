import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'

type Props = {
  onDetect: (code: string) => void
  onClose: () => void
}

const FORMATOS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
]

/**
 * Overlay de leitura do código de barras. Abre a câmera traseira, decodifica
 * no próprio aparelho (nada é enviado nem gravado) e devolve o código lido.
 */
export default function Scanner({ onDetect, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const jaDetectou = useRef(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    const hints = new Map()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATOS)
    const reader = new BrowserMultiFormatReader(hints)

    async function iniciar() {
      try {
        const controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: 'environment' } } },
          videoRef.current!,
          (result) => {
            if (result && !jaDetectou.current && !cancelado) {
              jaDetectou.current = true
              try {
                navigator.vibrate?.(60)
              } catch {
                /* vibração indisponível — ok */
              }
              controls.stop()
              onDetect(result.getText())
            }
          },
        )
        if (cancelado) controls.stop()
        else controlsRef.current = controls
      } catch (e) {
        if (!cancelado) {
          setErro(
            'Não consegui abrir a câmera. Verifique a permissão no Safari ou digite o código à mão.',
          )
          // eslint-disable-next-line no-console
          console.error(e)
        }
      }
    }
    iniciar()

    return () => {
      cancelado = true
      controlsRef.current?.stop()
    }
  }, [onDetect])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-grafite/95">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="font-medium">Aponte para o código de barras</span>
        <button
          onClick={onClose}
          className="rounded-full bg-white/15 px-4 py-2 text-sm font-semibold active:bg-white/25"
        >
          Fechar
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
          autoPlay
        />
        {/* moldura-guia */}
        {!erro && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-28 w-72 rounded-xl2 border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}
        {erro && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <p className="max-w-xs text-sm text-white">{erro}</p>
          </div>
        )}
      </div>

      <div className="px-4 py-4">
        <button onClick={onClose} className="btn-secundario w-full bg-white">
          Digitar o código à mão
        </button>
      </div>
    </div>
  )
}
