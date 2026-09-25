# WebUI Workbench

Ein **inoffizieller Fork von [Open WebUI Desktop](https://github.com/open-webui/desktop)**, kein eigenständiger Ersatz für Open WebUI. Die Arbeit der ursprünglichen Entwickler bleibt sichtbar; dieser Fork ergänzt optionale Konnektoren, Arbeitsbereiche und Vorschauen.

[English / Hauptdokumentation](README.md) · [Downloads](https://github.com/nicoegerer/webui-workbench/releases)

## Was ist anders?

- **Keine vorgegebenen Verbindungen:** Bei einer neuen Installation sind weder GitHub noch Garmin, OmniRoute oder andere MCPs eingerichtet. Vorlagen unter „Entdecken“ sind keine aktiven Verbindungen.
- **Eigene Dienste wählen:** Unter **Einstellungen → Dienste & Konnektoren** selbst hinzufügen. Aktivierte Konnektoren stehen anschließend allen Chats zur Verfügung; dort lassen sie sich pausieren oder entfernen.
- **Lokale Arbeitsbereiche:** Deinen echten Projektordner auswählen. Ein werkzeugfähiges Modell kann dort Dateien bearbeiten und Befehle ausführen.
- **Cloud-Arbeitsbereiche:** Dateien im ausgewählten GitHub-Repository und Branch bearbeiten; Schreiben erzeugt Commits. Kein Cloud-Terminal.
- **Vorschau:** Unterstützte statische HTML-Websites im Seitenbereich ansehen; Framework-Projekte vorher bauen.
- **Updates:** Automatische Upstream-Prüfung und getestete Fork-Releases, ohne wiederholt ZIP-Dateien herunterzuladen. Konflikte können weiterhin Wartung erfordern.

## Einstieg

1. Passenden Installer aus **diesem** Repository installieren.
2. Lokale Open-WebUI-Instanz einrichten oder deine eigene Instanz verbinden.
3. Einen Modellanbieter konfigurieren. Zugangsdaten und kostenpflichtige Abos sind nicht enthalten.
4. Zunächst einen normalen Chat testen, dann nur benötigte Dienste hinzufügen.
5. Für Dateiarbeit neben dem Eingabefeld einen lokalen Ordner oder ein Cloud-Repository auswählen.

Die neue App nutzt ein getrenntes Profil. Alte Chats und Verbindungen werden nicht ungefragt übernommen oder gelöscht. Zwei lokale Instanzen dürfen nicht denselben Port verwenden.

## Anleitungen

Die ausführlichen Anleitungen sind auf Englisch, mit deutschen Menübezeichnungen im Einstieg:

- [Erste Einrichtung](docs/getting-started.md)
- [GitHub verbinden](docs/integrations/github.md)
- [OmniRoute als Modellanbieter verwenden](docs/integrations/omniroute.md)
- [Garmin-MCP verbinden](docs/integrations/garmin.md)
- [Weitere Konnektoren](docs/services-and-connectors.md)
- [Dateien und Vorschau](docs/workspaces-and-preview.md)
- [Änderungen und automatische Updates](docs/upstream-and-releases.md)

**Wichtig:** Lokale Befehle laufen mit deinen Benutzerrechten. Remote-Modelle erhalten Chat-Inhalte und gegebenenfalls Werkzeugergebnisse, auch Gesundheitsdaten. Konnektoren können je nach Berechtigung Änderungen durchführen. [Sicherheits- und Datenschutzhinweise](SECURITY.md).

Die Desktop-Lizenz bleibt [AGPL-3.0](LICENSE); für die separat installierte Open-WebUI-Laufzeit gelten deren eigene Bedingungen. Keine offizielle Distribution oder Partnerschaft mit den genannten Anbietern.
