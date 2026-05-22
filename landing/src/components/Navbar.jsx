import React from 'react'

const Navbar = () => {
  return (
    <nav className="p-6 flex justify-between items-center">
      <div className="text-2xl font-bold">Memorix</div>
      <div className="space-x-4">
        <a href="#features" className="hover:text-blue-600">Features</a>
        <a href="#waitlist" className="bg-black text-white px-4 py-2 rounded">Join Waitlist</a>
      </div>
    </nav>
  )
}

export default Navbar
