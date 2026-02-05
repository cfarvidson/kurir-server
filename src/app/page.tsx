import { redirect } from "next/navigation";

export default function Home() {
  // Redirect to imbox or login
  redirect("/imbox");
}
