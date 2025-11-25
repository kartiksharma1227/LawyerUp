from flask import Flask, render_template, request, jsonify
from src.helper import download_hugging_face_embeddings
from langchain.vectorstores import Pinecone as LangchainPinecone
from langchain.chat_models import ChatOpenAI
from langchain.memory import ConversationBufferMemory
from langchain.chains import ConversationalRetrievalChain
from langchain.prompts import PromptTemplate
from dotenv import load_dotenv
from flask_cors import CORS
from groq import Groq
from pinecone import Pinecone, ServerlessSpec
import os

import re
import html

def format_response(text):
    """Format model text into safe HTML:

    - Escapes HTML to prevent injection
    - Converts **bold** to <strong>
    - Groups consecutive numbered lines into <ol>
    - Groups consecutive bullet lines (-, *, •) into <ul>
    - Bold headings like "1. Heading:" -> "1. <strong>Heading</strong>:"
    - Preserves paragraph breaks as <br>
    """
    if not text:
        return ""

    # Escape input first to avoid HTML injection
    text = html.escape(text.strip())

    # Convert markdown-style bold **text** to <strong>
    text = re.sub(r"\*\*(.*?)\*\*", r"<strong>\1</strong>", text)

    # Make numbered headings bold when followed by a colon: "1. Heading:"
    text = re.sub(r"^(\s*\d+\.\s*)([^:<\n]+):", r"\1<strong>\2</strong>:", text, flags=re.M)

    # Split lines and build HTML preserving lists
    lines = text.splitlines()
    out = []
    in_ul = False
    in_ol = False

    for line in lines:
        stripped = line.strip()
        ol_match = re.match(r"^\d+\.\s+(.*)", stripped)
        ul_match = re.match(r"^[-\u2022\*]\s+(.*)", stripped)

        if ol_match:
            # start ordered list if needed
            if not in_ol:
                if in_ul:
                    out.append("</ul>")
                    in_ul = False
                out.append("<ol>")
                in_ol = True
            out.append(f"<li>{ol_match.group(1)}</li>")

        elif ul_match:
            # start unordered list if needed
            if not in_ul:
                if in_ol:
                    out.append("</ol>")
                    in_ol = False
                out.append("<ul>")
                in_ul = True
            out.append(f"<li>{ul_match.group(1)}</li>")

        else:
            # close any open lists
            if in_ul:
                out.append("</ul>")
                in_ul = False
            if in_ol:
                out.append("</ol>")
                in_ol = False

            # blank lines -> <br>, otherwise raw line
            if stripped == "":
                out.append("<br>")
            else:
                out.append(stripped)

    # close lists at end
    if in_ul:
        out.append("</ul>")
    if in_ol:
        out.append("</ol>")

    # Join with <br> to preserve line breaks between blocks
    html_text = "<br>".join(out)

    # Reduce excessive vertical spacing by collapsing repeated <br> tags into a single <br>
    # e.g. turn "<br><br>" or "<br>\n<br>" into just "<br>"
    html_text = re.sub(r"(?:<br>\s*){2,}", "<br>", html_text)

    return html_text.strip()



# Load environment variables
load_dotenv()

# Retrieve API keys
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "key")

# Ensure API keys are set
if not PINECONE_API_KEY:
    raise ValueError("Missing PINECONE_API_KEY. Please set it in your environment variables.")

# Initialize Pinecone with new API (v3.0.0)
pc = Pinecone(api_key=PINECONE_API_KEY)

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Load embeddings
embeddings = download_hugging_face_embeddings()
index_name = "lawbot2"

# Connect to the existing Pinecone index
docsearch = LangchainPinecone.from_existing_index(
    index_name=index_name,
    embedding=embeddings
)

retriever = docsearch.as_retriever(search_type="similarity", search_kwargs={"k": 3})

# Initialize Groq client and create wrapper for LangChain
client = Groq(api_key=GROQ_API_KEY)

# Create a simple LLM wrapper for Groq
from langchain.llms.base import LLM
from typing import Optional, List, Any

class GroqLLM(LLM):
    client: Any
    model_name: str = "llama-3.1-8b-instant"
    
    def _call(self, prompt: str, stop: Optional[List[str]] = None) -> str:
        response = self.client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model=self.model_name,
        )
        return response.choices[0].message.content
    
    @property
    def _llm_type(self) -> str:
        return "groq"

llm = GroqLLM(client=client)

# Custom prompt template with memory support
system_prompt = system_prompt = (
    "You're LawBot, a friendly AI helping people understand Indian legal cases in simple, modern English. "
    "Speak clearly, be helpful, and sound like you're chatting with a friend—not a courtroom judge. "
    "Use examples when needed. Avoid legal jargon unless asked. Keep it chill, but informative."
   
    
)

# system_prompt = system_prompt = (
#     "You're LawBot, a friendly AI that helps people understand Indian legal cases in simple, modern English. "
#     "Speak clearly, be helpful, and sound like you're chatting with a friend—not a courtroom judge. "
#     "Use real-life examples when needed. Avoid legal jargon unless asked. Keep it chill but informative. "

#     "\n\nWhen there are steps involved, follow this format:\n"
#     "Step 1: Give the heading like this (no bold or symbols)\n"
#     "• Use bullets with a plain dot symbol (like this)\n"
#     "• Keep the text left-aligned and well spaced\n"
#     "• Do not use any Markdown formatting — no **, __, *, #, or HTML tags like <br>\n"

#     "\nKeep everything as plain text. The goal is to make the message easy to read without any styling symbols. "
#     "Structure your answers cleanly using headings and bullet points in plain English."
# )



template = f"""{system_prompt}

**Chat History**:
{{chat_history}}

**Context**:
{{context}}

**Question**: {{question}}

**Answer**:"""

prompt = PromptTemplate.from_template(template)

# Initialize conversation memory
memory = ConversationBufferMemory(
    memory_key="chat_history",
    return_messages=True,
    input_key="question",
    output_key="answer"
)

# Create conversational retrieval chain with memory
rag_chain = ConversationalRetrievalChain.from_llm(
    llm=llm,
    retriever=retriever,
    memory=memory,
    combine_docs_chain_kwargs={"prompt": prompt},
    return_source_documents=True
)

# Routes
@app.route("/chat")
def index():
    return render_template('chat.html')

@app.route("/chat/get", methods=["POST"])
def chat():
    data = request.json
    msg = data.get("msg", "").strip()

    if not msg:
        return jsonify({"error": "No input received."})

    # Get response from the model
    response = rag_chain({"question": msg})
    bot_answer = response.get("answer", "Sorry, I couldn't generate a response.")

    # Format response using the safer formatter
    formatted_response = format_response(bot_answer)

    return jsonify({"response": formatted_response})

@app.route("/chat_history", methods=["GET"])
def chat_history():
    # Retrieve the conversation history
    chat_history = memory.load_memory_variables({})["chat_history"]
    return jsonify({"history": chat_history})

if __name__ == '__main__':
    app.run(host="0.0.0.0", port=8080, debug=True)
