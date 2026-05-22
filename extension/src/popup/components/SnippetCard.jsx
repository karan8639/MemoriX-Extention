import React from 'react'

const SnippetCard = ({ snippet }) => {
  return (
    <div className="p-2 border-b">
      <p>{snippet.content}</p>
    </div>
  )
}

export default SnippetCard
