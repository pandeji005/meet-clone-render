from flask import Flask, render_template, redirect, url_for, request, flash
from flask_socketio import SocketIO, join_room, emit
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.pool import NullPool

import uuid
import datetime
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = 'super-secret-key-12345'

# SQLite configuration for PythonAnywhere portability
basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'meeting_db.sqlite')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'poolclass': NullPool
}

db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# Database Model
class Meeting(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    meeting_id = db.Column(db.String(50), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

# Ensure tables are created
with app.app_context():
    db.create_all()

@app.route('/')
def dashboard():
    return render_template('dashboard.html')

@app.route('/create_meeting', methods=['POST'])
def create_meeting():
    # Generate a random 9-character meeting ID
    new_meeting_id = str(uuid.uuid4())[:9]
    new_meeting = Meeting(meeting_id=new_meeting_id)
    db.session.add(new_meeting)
    db.session.commit()
    return redirect(url_for('meeting', room_id=new_meeting_id))

@app.route('/join_meeting', methods=['POST'])
def join_meeting():
    room_id = request.form.get('room_id')
    if room_id:
        room_id = room_id.strip()
        # Verify if meeting exists
        meeting_exists = Meeting.query.filter_by(meeting_id=room_id).first()
        if meeting_exists:
            return redirect(url_for('meeting', room_id=room_id))
        else:
            flash("Meeting ID not found. Please check and try again.", "error")
            return redirect(url_for('dashboard'))
    return redirect(url_for('dashboard'))

@app.route('/meeting/<room_id>')
def meeting(room_id):
    # Verify if meeting exists before rendering the room
    meeting_exists = Meeting.query.filter_by(meeting_id=room_id).first()
    if not meeting_exists:
        flash("Meeting ID not found.", "error")
        return redirect(url_for('dashboard'))
    return render_template('index.html', room_id=room_id)

@socketio.on('join')
def on_join(data):
    room = data['room']
    join_room(room)
    # Broadcast to others in the room that this user joined
    emit('user-joined', {'sid': request.sid, 'room': room}, room=room, include_self=False)

@socketio.on('signal')
def handle_signal(data):
    # Relay the signal to a specific user or the room
    target_sid = data.get('to')
    if target_sid:
        emit('signal', {'sid': request.sid, 'data': data['data']}, room=target_sid)
    else:
        emit('signal', {'sid': request.sid, 'data': data['data']}, room=data['room'], include_self=False)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)