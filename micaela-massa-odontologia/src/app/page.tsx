import { redirect } from 'next/navigation';

/** El día empieza en la agenda. */
export default function Inicio() {
  redirect('/agenda');
}
