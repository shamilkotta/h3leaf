import { H3 } from "h3";

export const app = new H3().use((event) => {
  event.res.headers.set("x-powered-by", "h3leaf");
});
