import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base precisa bater com o nome do repositório no GitHub Pages:
// https://<usuario>.github.io/donna-onca/
export default defineConfig({
  base: '/donna-onca/',
  plugins: [react()],
})
