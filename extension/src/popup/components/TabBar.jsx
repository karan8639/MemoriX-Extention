import React from 'react'

const TabBar = ({ activeTab, setActiveTab }) => {
  return (
    <div className="flex border-b">
      <button 
        className={`px-4 py-2 ${activeTab === 'scratchpad' ? 'border-b-2 border-blue-500' : ''}`}
        onClick={() => setActiveTab('scratchpad')}
      >
        Scratchpad
      </button>
      <button 
        className={`px-4 py-2 ${activeTab === 'relate' ? 'border-b-2 border-blue-500' : ''}`}
        onClick={() => setActiveTab('relate')}
      >
        Relate
      </button>
    </div>
  )
}

export default TabBar
