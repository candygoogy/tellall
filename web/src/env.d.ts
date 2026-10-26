/// <reference types="vite/client" />

declare module "virtual:examples" {
  const data: import("./example-types.ts").ExampleData;
  export default data;
}
