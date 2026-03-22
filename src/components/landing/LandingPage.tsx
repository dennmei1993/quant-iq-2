'use client'
// src/components/landing/LandingPage.tsx
// The landing page HTML (quant-iq.html) is placed at /public/landing-embed.html
// For the Next.js app, we inline the full page as a React component.
// This keeps styles/scripts isolated and lets us ship the HTML you already built.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function LandingPage() {
  const router = useRouter()

  useEffect(() => {
    // Intercept the "Get Early Access" / sign-up form to route to /auth/signup
    const form = document.querySelector('.signup-form')
    if (form) {
      const btn = form.querySelector('button')
      if (btn) {
        btn.onclick = (e) => {
          e.preventDefault()
          const input = form.querySelector('input') as HTMLInputElement
          const email = input?.value ?? ''
          router.push(`/auth/signup${email ? `?email=${encodeURIComponent(email)}` : ''}`)
        }
      }
    }
  }, [router])

  // NOTE: In production, import the CSS from globals.css and render JSX components.
  // For the MVP, we embed the landing page as an iframe pointing to /landing.html
  // which you copy from the quant-iq.html file into /public/landing.html
  return (
    <iframe
      src="/landing.html"
      style={{ width: '100%', height: '100vh', border: 'none', display: 'block' }}
      title="Quant IQ"
    />
  )
}
