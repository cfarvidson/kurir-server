import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 11,
    color: "#1a1a1a",
    lineHeight: 1.5,
  },
  header: {
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  subject: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
  },
  metaRow: {
    fontSize: 9,
    color: "#6b7280",
    marginBottom: 2,
  },
  metaLabel: {
    fontFamily: "Helvetica-Bold",
    color: "#4b5563",
  },
  body: {
    fontSize: 11,
    lineHeight: 1.6,
  },
  paragraph: {
    marginBottom: 8,
  },
});

interface EmailPdfProps {
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: string;
  body: string;
}

export function buildEmailPdf(props: EmailPdfProps) {
  return <EmailPdfDocument {...props} />;
}

function EmailPdfDocument({ subject, from, to, cc, date, body }: EmailPdfProps) {
  // Split body into paragraphs for better rendering
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  // If no double-newline paragraphs, split by single newlines
  const lines =
    paragraphs.length <= 1
      ? body.split(/\n/).map((l) => l.trim())
      : [];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.subject}>{subject}</Text>
          <Text style={styles.metaRow}>
            <Text style={styles.metaLabel}>From: </Text>
            {from}
          </Text>
          <Text style={styles.metaRow}>
            <Text style={styles.metaLabel}>To: </Text>
            {to}
          </Text>
          {cc && (
            <Text style={styles.metaRow}>
              <Text style={styles.metaLabel}>Cc: </Text>
              {cc}
            </Text>
          )}
          <Text style={styles.metaRow}>
            <Text style={styles.metaLabel}>Date: </Text>
            {date}
          </Text>
        </View>

        <View style={styles.body}>
          {paragraphs.length > 1
            ? paragraphs.map((p, i) => (
                <Text key={i} style={styles.paragraph}>
                  {p}
                </Text>
              ))
            : lines.map((line, i) => (
                <Text key={i}>
                  {line || " "}
                </Text>
              ))}
        </View>
      </Page>
    </Document>
  );
}
