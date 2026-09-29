import { useState } from "react";
import Shelf from "./pages/Shelf";
import Reader from "./pages/Reader";
import type { Book } from "./types";

export default function App() {
  const [book, setBook] = useState<Book | null>(null);
  return book ? (
    <Reader book={book} onBack={() => setBook(null)} />
  ) : (
    <Shelf onOpen={setBook} />
  );
}
