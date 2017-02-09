import 'reflect-metadata';
import { createConnection, 
  IConnection, 
  TextDocuments, 
  InitializeParams, 
  InitializeResult, 
  CompletionList, Hover } from 'vscode-languageserver';
import { MarkedString } from 'vscode-languageserver-types';
import { HTMLDocument, getLanguageService } from './aurelia-languageservice/aureliaLanguageService';
import { getLanguageModelCache } from './languageModelCache';
import { Container } from 'aurelia-dependency-injection';
import CompletionItemFactory from './CompletionItemFactory';
import HoverProviderFactory from './HoverProviderFactory';
import ElementLibrary from './Completions/Library/_elementLibrary';
import CommandHandler from './aurelia-cli/commandHandler';

// Bind console.log & error to the Aurelia output
let connection: IConnection = createConnection();
console.log = connection.console.log.bind(connection.console);
console.error = connection.console.error.bind(connection.console);

// Cache documents
let documents: TextDocuments = new TextDocuments();
documents.listen(connection);
let htmlDocuments = getLanguageModelCache<HTMLDocument>(10, 60, document => getLanguageService().parseHTMLDocument(document));
documents.onDidClose(e => htmlDocuments.onDocumentRemoved(e.document));
connection.onShutdown(() => htmlDocuments.dispose());

// Setup Aurelia dependency injection
let globalContainer = new Container();
let completionItemFactory = <CompletionItemFactory> globalContainer.get(CompletionItemFactory);
let hoverProviderFactory = <HoverProviderFactory> globalContainer.get(HoverProviderFactory);

let workspacePath: string;

// Register character to lisen for
connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspacePath = params.rootPath;
  
  // TODO: find other way to preload element library
  let dummy = globalContainer.get(ElementLibrary);
  return {
    capabilities: {
      completionProvider: { resolveProvider: false, triggerCharacters: ['<', ' ', '.', '[', '"', '\''] },
      hoverProvider: true,
      textDocumentSync: documents.syncKind,
      executeCommandProvider: { commands: [
        'aurelia-cli.new', 
        'aurelia-cli.generate', 
        'aurelia-cli.build',
        'aurelia-cli.test',
        'aurelia-cli.run',
        'aurelia-cli.run-watch'] 
      }   
    },
  };
});

// Handle commands
let commandHandler = new CommandHandler();
connection.onExecuteCommand((handler) => {
  commandHandler.handle(workspacePath, handler.command, handler.arguments);
});

// Register and get changes to Aurelia settings
let aureliaSettings;
connection.onDidChangeConfiguration(change => aureliaSettings = change.settings.aurelia);

// Setup Validation
let languageService = getLanguageService();
documents.onDidChangeContent(async change => {
  let htmlDocument = htmlDocuments.get(change.document);
  const diagnostics = await languageService.doValidation(change.document, htmlDocument);
  connection.sendDiagnostics({ uri: change.document.uri, diagnostics });
});

// Lisen for completion requests
connection.onCompletion(textDocumentPosition => {
  let document = documents.get(textDocumentPosition.textDocument.uri);
  let text = document.getText();
  let offset = document.offsetAt(textDocumentPosition.position);
  let triggerCharacter = text.substring(offset - 1, offset);
  let position = textDocumentPosition.position;

  return completionItemFactory.create(triggerCharacter, position, text, offset, textDocumentPosition.textDocument.uri);
});

connection.onHover(textDocumentPosition => {
	let document = documents.get(textDocumentPosition.textDocument.uri);
  let text = document.getText();
  let offset = document.offsetAt(textDocumentPosition.position);	

  return hoverProviderFactory.create(text, offset);
});

connection.listen();
