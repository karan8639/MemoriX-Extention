import React from 'react'
import { Search } from 'lucide-react'

const SearchBar = () => {
  return (
    <div className="relative mb-4">
      <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
      <input 
        type="text" 
        placeholder="Search snippets..." 
        className="w-full pl-8 pr-4 py-2 border rounded-md text-sm"
      />
    </div>
  )
}

export default SearchBar
