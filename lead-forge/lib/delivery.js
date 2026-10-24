'use strict';

const fs = require('fs');
const path = require('path');

function csvCell(value) {
  const text = Array.isArray(value) ? value.join('; ') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function writeCsv(file, leads) {
  const columns = [
    ['business_name', 'name'], ['category', 'category'], ['address', 'address'],
    ['phone', 'phone'], ['website', 'website'], ['public_business_email', 'email'],
    ['rating', 'rating'], ['review_count', 'reviewCount'], ['signals_found', 'signals'],
    ['fit_score', 'fitScore'], ['fit_reasons', 'fitReasons'],
    ['email_1_draft', 'email1'], ['email_2_draft', 'email2'], ['email_3_draft', 'email3'],
  ];
  const lines = [
    columns.map(([heading]) => csvCell(heading)).join(','),
    ...leads.map((lead) => columns.map(([, key]) => csvCell(lead[key])).join(',')),
  ];
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
}

function pdfEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '?');
}

function truncate(value, length = 92) {
  const text = String(value);
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function buildOnePagePdf(lines) {
  const commands = ['BT', '/F1 11 Tf', '48 750 Td'];
  for (let i = 0; i < lines.length; i += 1) {
    if (i > 0) commands.push('0 -17 Td');
    commands.push(`(${pdfEscape(truncate(lines[i]))}) Tj`);
  }
  commands.push('ET');
  const stream = commands.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

function signalInsights(leads) {
  const counts = new Map();
  for (const lead of leads) {
    for (const signal of lead.signals || []) counts.set(signal, (counts.get(signal) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
}

function writeSummaryPdf(file, { niche, city, radius, requestedCount, leads, angle, sourceErrors = [] }) {
  const insights = signalInsights(leads);
  const lines = [
    'Lead Forge - Vetted Lead Pack',
    `Niche: ${niche} | Market: ${city} | Radius: ${radius} miles`,
    `Requested: ${requestedCount} | Qualified and deduplicated: ${leads.length}`,
    '',
    'Why this niche may buy:',
    angle,
    '',
    'Top signals:',
    ...(insights.length ? insights.map(([signal, count]) => `${signal}: ${count} leads`) : ['No qualifying signals found']),
    '',
    'Top 10 leads by fit score:',
    ...leads.slice(0, 10).map((lead, index) => `${index + 1}. ${lead.name} - ${lead.fitScore}/100 - ${lead.category}`),
    ...(sourceErrors.length ? ['', `Source warnings: ${sourceErrors.join('; ')}`] : []),
    '',
    'Review and Jordan approval are required before delivery or outreach.',
  ];
  fs.writeFileSync(file, buildOnePagePdf(lines));
}

function outreachDrafts(lead, config, senderAddress) {
  if (!senderAddress) throw new Error('LEAD_FORGE_SENDER_ADDRESS is required for outreach drafts');
  const signal = (lead.signals && lead.signals[0] ? lead.signals[0].replace(/_/g, ' ') : 'local growth opportunity');
  const footer = `\n\nOur mailing address: ${senderAddress}\nReply "opt out" and we will not contact you again.`;
  return {
    email1: `Subject: An idea for ${lead.name}\n\nHi ${lead.name} team,\nI noticed your ${signal}. ${config.why_theyd_buy} Would a short, no-pressure review be useful?${footer}`,
    email2: `Subject: Re: An idea for ${lead.name}\n\nFollowing up with one practical thought: a focused local campaign could turn more nearby searches into direct conversations. Interested in a one-page outline?${footer}`,
    email3: `Subject: Closing the loop\n\nI will close the loop after this note. If improving local demand is a priority for ${lead.name}, reply and I will send the outline.${footer}`,
  };
}

function ensurePackDirectory(root, id) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: false });
  return dir;
}

module.exports = { buildOnePagePdf, ensurePackDirectory, outreachDrafts, signalInsights, writeCsv, writeSummaryPdf };
