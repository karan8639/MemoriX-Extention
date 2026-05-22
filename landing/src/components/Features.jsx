import React from 'react'

const Features = () => {
  return (
    <section id="features" className="py-20 bg-gray-50">
      <div className="max-w-4xl mx-auto grid grid-cols-2 gap-8">
        <div>
          <h3 className="text-2xl font-bold mb-2">Smart Scratchpad</h3>
          <p>Capture ideas instantly without leaving your current tab.</p>
        </div>
        <div>
          <h3 className="text-2xl font-bold mb-2">One-Click Relate</h3>
          <p>Find connections between your snippets and projects automatically.</p>
        </div>
      </div>
    </section>
  )
}

export default Features
