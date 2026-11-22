import React from "react"

export const ServerSliceRenderer = ({ sliceId, children }) => {
  const contents = [
    React.createElement(`slice-start`, {
      id: `${sliceId}-1`,
    }),
    React.createElement(`slice-end`, {
      id: `${sliceId}-1`,
    }),
  ]

  if (children) {
    // children がある場合は、スライスを前半と後半に分割する
    // render-html の renderSlices を参照
    contents.push(children)
    contents.push(
      React.createElement(`slice-start`, {
        id: `${sliceId}-2`,
      }),
      React.createElement(`slice-end`, {
        id: `${sliceId}-2`,
      })
    )
  }

  return contents
}
