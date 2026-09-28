import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
// SGDS masthead ("A Singapore Government Agency Website" banner). The theme file only
// defines :root CSS variables the component reads — it doesn't restyle the app.
import '@govtechsg/sgds-web-component/themes/day.css'
import '@govtechsg/sgds-web-component/components/Masthead/index.js'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
