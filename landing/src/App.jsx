import React from 'react'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import Features from './components/Features'
import HowItWorks from './components/HowItWorks'
import WaitlistForm from './components/WaitlistForm'
import PrivacyBadge from './components/PrivacyBadge'
import Footer from './components/Footer'

function App() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <WaitlistForm />
        <PrivacyBadge />
      </main>
      <Footer />
    </div>
  )
}

export default App
