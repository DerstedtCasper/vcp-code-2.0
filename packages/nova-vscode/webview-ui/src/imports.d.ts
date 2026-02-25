declare module "*.svg" {
  const src: string
  export default src
}

declare module "*?worker&url" {
  const workerUrl: string
  export default workerUrl
}
