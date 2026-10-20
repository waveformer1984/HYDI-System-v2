import type { GetServerSideProps } from 'next';
import fs from 'fs';
import path from 'path';

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const html = fs.readFileSync(path.join(process.cwd(), 'lib', 'forge-board', 'ui.html'), 'utf8');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(html);
  return { props: {} };
};

export default function ForgeBoardPage(): null {
  return null;
}
