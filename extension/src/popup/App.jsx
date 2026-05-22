import React from 'react'
import TabBar from './components/TabBar'
import SearchBar from './components/SearchBar'
import Scratchpad from './components/Scratchpad'
import RelatePanel from './components/RelatePanel'

function App() {
  const [activeTab, setActiveTab] = React.useState('scratchpad')

  return (
    <div className="w-80 min-h-[400px] bg-white p-4">
      <h1 className="text-xl font-bold mb-4">Memorix</h1>
      <SearchBar />
      <TabBar activeTab={activeTab} setActiveTab={setActiveTab} />
      <div className="mt-4">
        {activeTab === 'scratchpad' ? <Scratchpad /> : <RelatePanel />}
      </div>
    </div>
  )
}

export default App
