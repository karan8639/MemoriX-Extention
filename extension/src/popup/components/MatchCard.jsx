import React from 'react'

const MatchCard = ({ match }) => {
  return (
    <div className="p-2 bg-gray-50 rounded mb-2">
      <p className="font-medium">{match.title}</p>
    </div>
  )
}

export default MatchCard
