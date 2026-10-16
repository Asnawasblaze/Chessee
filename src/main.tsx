import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { initStyle } from './theme/styleStore'
import HomePage from './pages/HomePage.tsx'

initStyle()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HomePage />
  </StrictMode>,
)
