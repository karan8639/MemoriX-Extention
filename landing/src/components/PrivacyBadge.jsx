import React from 'react'
import { ShieldCheck } from 'lucide-react'

const PrivacyBadge = () => {
  return (
    <div className="flex justify-center items-center gap-2 py-10 text-gray-500">
      <ShieldCheck className="h-5 w-5" />
      <span>Local-first. Your data stays on your machine.</span>
    </div>
  )
}

export default PrivacyBadge
