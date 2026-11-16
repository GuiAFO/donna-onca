import { useId } from 'react'

type Props = {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  listId?: string
}

/**
 * Campo de texto simples. Para ditar, basta tocar no campo e usar o
 * microfone nativo do teclado do iPhone (sem botão próprio no app).
 */
export default function CampoVoz({
  label,
  value,
  onChange,
  placeholder,
  autoCapitalize = 'sentences',
  listId,
}: Props) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="rotulo">
        {label}
      </label>
      <input
        id={id}
        className="campo"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoCapitalize={autoCapitalize}
        list={listId}
        enterKeyHint="done"
      />
    </div>
  )
}
