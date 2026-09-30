# Eigene Dienste verbinden

[Dokumentation](../README.de.md) · [English](services-and-connectors.md)

WebUI Workbench enthält **keine voreingerichteten Konten, MCPs oder Modellanbieter**. Du wählst deine eigenen Verbindungen. Vorlagen unter „Entdecken“ sind noch keine aktiven Verbindungen. Bereits gespeicherte Konnektoren bleiben bei Updates erhalten.

## 1. Was möchtest du verbinden?

| Vorhandener Dienst                         | Richtige Einstellung                                                            | Ergebnis                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Open-WebUI-Server                          | Äußere Desktop-Verbindungen                                                     | Öffnet diesen Chat-Server; richtet keine Modelle oder Werkzeuge ein                         |
| OpenAI-kompatible Modell-API oder Gateway  | Open WebUI → Administrator-Einstellungen → Verbindungen                         | Stellt Chat-Modelle bereit; API-Basisadresse des Anbieters verwenden, häufig mit `/v1`      |
| Lokaler MCP mit Startbefehl und **stdio**  | Desktop → Einstellungen → Dienste & Konnektoren → Entdecken → Lokaler Konnektor | Startet den MCP über den lokalen Adapter                                                    |
| Vorhandene **Streamable-HTTP-MCP**-Adresse | Benutzerdefinierter Remote-Konnektor / Remote-MCP                               | Verbindet den Werkzeug-Endpunkt ohne lokale Serverinstallation                              |
| Normales Hintergrundprogramm               | Erweitert hinzufügen → Lokaler Prozess                                          | Startet und überwacht einen Prozess; macht daraus nicht automatisch Werkzeuge               |
| Lokale Projektdateien und Shell            | Desktop → Open Terminal; Projektordner neben dem Eingabefeld auswählen          | Dateizugriff im echten lokalen Ordner                                                       |
| GitHub-Repository                          | [Arbeitsbereiche und GitHub-Zugriff](workspaces-and-preview.md#github-access)   | Dateien im gewählten Branch lesen/schreiben; Schreiben erzeugt Commits, kein Cloud-Terminal |

Die äußeren Desktop-Einstellungen und die Einstellungen innerhalb von Open WebUI sind zwei Ebenen. Ein Modell-Gateway gehört zu den **Modell-Verbindungen**, nicht in die MCP-Werkzeugliste. Du kannst seinen Prozess zusätzlich vom Desktop verwalten lassen.

## 2. Anbieter vorbereiten

Lies die Installations-, Transport- und Anmeldeanleitung des jeweiligen Servers. Installiere seine Voraussetzungen und führe Anmeldung, Browser-Freigabe oder MFA selbst außerhalb des Chats durch. **Keine Passwörter oder Tokens an das Modell schicken.** Gib nur notwendige Berechtigungen frei.

Lokale MCP-Server nutzen unabhängig vom Anbieter denselben allgemeinen Anschluss. Anbieterabhängige Anmeldung und Funktionen kommen vom jeweiligen MCP-Server, nicht aus diesem Fork.

## 3. Lokalen MCP einrichten

Unter **Lokaler Konnektor** überträgst du den vom Server-Autor angegebenen stdio-Startbefehl in die Felder:

| Feld                                       | Bedeutung                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| Name                                       | Frei wählbare Bezeichnung; beeinflusst den technischen Anschluss nicht                |
| Serverprogramm                             | Nur die ausführbare Datei; bei Suchproblemen ihr vollständiger Pfad                   |
| Argumente, eines pro Zeile                 | Jedes Argument einzeln in derselben Reihenfolge; das Serverprogramm nicht wiederholen |
| In Chats verwenden und automatisch starten | Globale Freigabe: Verbindung starten und Werkzeuge allen Chats anbieten               |
| Erweitert → Lokaler Port                   | Freier Port des Adapters, nicht des stdio-Unterprozesses                              |
| Adapterprogramm                            | `uvx` oder dessen vollständiger Pfad; unabhängig vom Serverprogramm                   |
| Arbeitsverzeichnis                         | Optionales Startverzeichnis des Prozesses; nicht der Arbeitsbereich des Chats         |
| Umgebungsvariablen                         | Vom Anbieter geforderte Werte; Geheimnisse hier statt in Argumenten hinterlegen       |
| Status-URL                                 | Optionaler, tatsächlich unterstützter Prüf-Endpunkt; nicht jeder Dienst hat `/health` |
| Startzeitlimit / Neustarts                 | Zeit für den ersten Start lassen; vor mehr Wiederholungen die Fehlerursache prüfen    |

Beispiel zum Aufteilen eines Befehls (**nur Platzhalter**, kein installierbarer Konnektor): Aus `python "C:\Tools\example-mcp\server.py" --transport stdio` wird Serverprogramm `python` und folgende drei Argumentzeilen:

```text
C:\Tools\example-mcp\server.py
--transport
stdio
```

Ein Pfad mit Leerzeichen braucht im Argumentfeld keine zusätzlichen Anführungszeichen. Die App startet ohne Shell: `&&`, Umleitungen, `%VARIABLE%`, `~` und Shell-Ausdrücke werden nicht ausgewertet. Bei `.cmd`-/`.bat`-Startern unter Windows kann stattdessen das zugrunde liegende Programm mit Skriptpfad erforderlich sein; dafür die Anleitung des Servers verwenden.

Der Desktop startet den allgemeinen MCP-zu-OpenAPI-Adapter mit `uvx`, bindet ihn an `127.0.0.1` und erzeugt einen Verbindungsschlüssel. Installiere `uv`/`uvx` separat, falls es fehlt. Keine zusätzlichen Terminal- oder Werkzeug-Einträge von Hand anlegen.

## 4. Remote-MCP verbinden

Verwende die genaue **Streamable-HTTP-MCP**-Adresse und eine unterstützte Authentifizierung des Anbieters. Tokens gehören ins dafür vorgesehene Feld. Eine normale Website, Modell-API, OpenAPI-Datei oder alte SSE-Adresse ist nicht dasselbe.

Es gibt **keinen universellen OAuth-Login für alle Anbieter**. Ein Katalogeintrag meldet kein Konto an. Falls der Anbieter einen hier nicht unterstützten Anmeldeablauf benötigt, verwende einen kompatiblen, bereits authentifizierten lokalen Adapter oder unterstützten Endpunkt. Ein Kontopasswort ersetzt keinen Bearer-Token. Für GitHub gibt es zusätzlich den [CLI-Anmeldeweg](workspaces-and-preview.md#github-access).

## 5. Hintergrundprozess oder Modell-Gateway

Unter **Lokaler Prozess** trägst du Programm, Argumente, gegebenenfalls Arbeitsverzeichnis, Umgebungsvariablen und einen dokumentierten Status-Endpunkt ein. Das ist reine Prozessverwaltung; ein laufender Prozess ist noch kein Modell oder Werkzeug.

Läuft dein Gateway bereits separat, brauchst du keinen zweiten Prozess:

1. Gateway nach seiner eigenen Anleitung installieren und anmelden.
2. OpenAI-kompatible API-Basisadresse (häufig mit `/v1`) und benötigten Schlüssel unter **Open WebUI → Administrator-Einstellungen → Verbindungen** eintragen.
3. Modellliste aktualisieren, ein Modell wählen und eine einfache Nachricht senden.

Den tatsächlich eingestellten Port verwenden und dort keine zweite Kopie starten. Läuft Open WebUI auf einem anderen Server oder in einem Container, bezeichnet `127.0.0.1` diesen Server/Container, nicht deinen Desktop. Dafür eine gesicherte Netzwerkverbindung passend zu deiner Installation einrichten.

Bei npm-Programmen unter Windows findest du `node.exe` mit `where.exe node` und das globale Paketverzeichnis mit `npm root -g`. Verwende den dokumentierten CLI-Skriptpfad des Pakets, keine fremden Benutzerpfade. Der erste Start kann mehrere Minuten dauern; einen unterstützten Status-Endpunkt aus der Anbieteranleitung verwenden.

Pausieren oder Entfernen eines Prozesses entfernt nicht automatisch die separat eingerichtete Modell-Verbindung in Open WebUI. Diese bei Bedarf dort verwalten.

Für rein lokale Nutzung Dienste an **`127.0.0.1`** binden. `0.0.0.0` ohne Authentifizierung kann anderen erreichbaren Geräten Zugriff auf deine Konten oder Modellguthaben geben. Authentifizierung nicht für eine grüne Statusanzeige abschalten.

## 6. Open Terminal und echte Projektordner

Öffne **Desktop-Einstellungen → Open Terminal → Installieren/Starten**. Bei Bedarf installiert die App ihre getestete Laufzeit. **Starten** hält den Dienst für diese Sitzung aktiv, auch wenn **Beim Start automatisch starten** aus ist. Einschalten startet ihn sofort und bei künftigen App-Starts; Ausschalten beendet keine laufende Sitzung. Bei neuen Installationen bleibt der Schalter aus. **Stoppen** beendet die aktive Instanz. Dasselbe gilt unter **Inferenz-Laufzeit → llama.cpp**; zum Chatten muss zusätzlich ein lokales Modell installiert und ausgewählt sein. Startfehler werden in den Einstellungen angezeigt und nicht als erfolgreiche Verbindung gemeldet.

Wurde ein normales Programm versehentlich als MCP gespeichert, ändere unter **Dienste & Konnektoren → Deine → Verwalten → Erweitert → Verbindungstyp** auf **Lokaler Prozess** und speichere. Programm und Argumente bleiben erhalten, reine Adapter-Einstellungen werden entfernt. Der Dialog schließt sich beim Speichern; der Start läuft in der Dienstkarte weiter. Dort findest du Status, Protokoll und Stoppen. Wiederholte Startfehler enden spätestens am eingestellten Neustartlimit.

Ohne eingestelltes Arbeitsverzeichnis nutzt der Dienst deinen Benutzerordner. Wähle für ein Projekt dessen echten Ordner am Arbeitsbereich-Knopf neben dem Nachrichteneingabefeld. Dabei startet die nötige Arbeitsbereich-Instanz automatisch. Ein Ordnerwechsel verschiebt keine Dateien. Nicht mehr benötigte Chat-Instanzen werden bereinigt; laufende Befehle, Terminalsitzungen und bewusst gestartete Dienste bleiben erhalten.

Lokale Befehle laufen mit deinen Benutzerrechten, **nicht in einer Sandbox**. GitHub-Cloud-Arbeitsbereiche bieten keine Cloud-Shell. Mehr unter [Dateien und Vorschau](workspaces-and-preview.md).

## 7. Prüfen und Fehler eingrenzen

1. Den verwalteten Open-WebUI-Server starten und für automatische Registrierung als Administrator anmelden.
2. Unter **Deine** den Status und das **Protokoll** ansehen. „Erreichbar“ bestätigt nur eine Endpunktprüfung.
3. Eine harmlose, lesende Werkzeugaktion testen und den tatsächlichen Werkzeugaufruf prüfen. Eine normale Chat-Antwort allein reicht nicht.
4. Für Dateien einen Wegwerf-Testordner auswählen, eine kleine Testdatei anlegen lassen und **Dateien** sowie den vollständigen Pfad kontrollieren.

| Problem                                | Zuerst prüfen                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Programm nicht gefunden                | Voraussetzung installieren oder vollständigen Programmpfad verwenden; nach PATH-Änderungen Desktop neu starten               |
| Port belegt                            | Doppelten Dienst gezielt beenden oder anderen freien Adapter-Port verwenden                                                  |
| Login-/MFA-Fehler                      | Außerhalb des Chats anmelden, Berechtigungen und Token-Ablauf prüfen                                                         |
| Prozess endet sofort                   | Erste Fehlermeldung im Protokoll, Argumente, Laufzeitversion und Startordner                                                 |
| Dienst läuft, Werkzeuge fehlen         | Verbindungstyp, Administrator-Synchronisierung, Berechtigungen und werkzeugfähiges Modell                                    |
| Open Terminal stoppt direkt nach Start | Desktop aktualisieren; bis einschließlich `workbench.3` konnte die Bereinigung manuell gestartete Dienste irrtümlich stoppen |
| Falscher Ordner / keine Vorschau       | Aktuellen Arbeitsbereich und vollständigen Pfad prüfen; Arbeitsbereich-Anleitung beachten                                    |

## Zugriff verwalten und Konfiguration teilen

Aktivierte Desktop-Konnektoren stehen allen Chats zur Verfügung. **Pausieren** unter **Deine** bewahrt die Einstellungen, beendet/deaktiviert aber den Zugriff. **Entfernen** löscht die gespeicherte Verbindung und ihre verwaltete Registrierung – nicht dein Anbieterkonto, die Drittanbieterinstallation oder separat gespeicherte Login-Tokens. Tokens gegebenenfalls beim Anbieter widerrufen.

Ein Export lässt verwaltete Umgebungswerte und eigene Token-/Schlüsselfelder weg. Er ist **kein allgemeiner Geheimnisfilter**: Adressen, Argumente, Namen und Pfade können private Daten enthalten. Vor dem Teilen vollständig prüfen. Importierte Befehle vor dem Bestätigen lesen; sie können nach Aktivierung Code ausführen oder Daten senden.

[Sicherheit und Datenschutz](../SECURITY.md) · [Hilfe mit bereinigten Protokollen](../SUPPORT.md)
