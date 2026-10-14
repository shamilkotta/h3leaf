import { H3 } from "h3";

export const app = new H3().use((event) => {
  event.res.headers.set("x-powered-by", "h3leaf");
});

/** Cron Trigger handler; forwarded to the Worker's default export. */
export const scheduled = (controller: { cron: string }) => {
  console.log(`cron fired: ${controller.cron}`);
};
