import csv
import smtplib
import ssl
from email.message import EmailMessage

with open("data.csv", "r", encoding="utf-8-sig") as file:
    reader = csv.DictReader(file, delimiter=";")
    records = list(reader)

print("\n Δεδομένα \n")
for row in records:
    print(row)

print("\n")
from datetime import datetime


today = datetime.today()

#dhmioyrgia pinaka me tous xristes poy xreiazonte email
reminders = []  

for row in records:
    date_str = row["Ημερομηνία"]
    deadline = datetime.strptime(date_str, "%d/%m/%Y")
    days_left = (deadline - today).days

    #elegxos gia prothesmies logariasmon kai an exei eidopoihthei idi
    if days_left <= 3 and days_left >= 0:
        reminders.append(row)  
    
#dhmioyrgia pinaka me vasi ton xrhsth kai tous logariasmoys tou
reminders_by_user = {}

for row in reminders:
    name = row["Όνομα"]
    if name not in reminders_by_user:
        reminders_by_user[name] = []
    reminders_by_user[name].append(row)

print("Πληρωμές που χρειάζονται υπενθύμιση \n")

for user, items in reminders_by_user.items():
    print(user + ":")
    for bill in items:
        print(f"  - {bill['Κατηγορία']} ({bill['Ποσό']}€) μέχρι {bill['Ημερομηνία']}")



SENDER_EMAIL = "nefelh171000@gmail.com"
APP_PASSWORD = "znoy udzz aelj zxtp"


for user, items in reminders_by_user.items():

    recipient_email = items[0]["Email"]

    # dhmioyrgia email
    message = EmailMessage()
    message["From"] = SENDER_EMAIL
    message["To"] = recipient_email
    message["Subject"] = "Υπενθύμιση Πληρωμών"

    
    body = f"Γεια σου {user},\n\n"
    body += "Αυτό είναι ένα φιλικό reminder για τις επερχόμενες πληρωμές σου:\n\n"
    

    for bill in items:
        category = bill["Κατηγορία"]
        amount = bill["Ποσό"]
        date = bill["Ημερομηνία"]
        body += f"  {category} - {amount}€ μέχρι {date}\n"

    body += "Με εκτίμηση,\nΗ ομάδα υποστήριξης\n"

    message.set_content(body)

    #apostolh
    context = ssl.create_default_context()
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context) as server:
        server.login(SENDER_EMAIL, APP_PASSWORD)
        server.send_message(message)

    print(f" Email στάλθηκε σε  {recipient_email}")

    for bill in items:
        bill["Κατάσταση"] = "Ειδοποίηση-Στάλθηκε"


with open("data.csv", "w", encoding="utf-8-sig", newline="") as file:
    writer = csv.DictWriter(file, fieldnames=["Όνομα", "Κατηγορία", "Ποσό", "Ημερομηνία", "Email", "Κατάσταση"], delimiter=";")
    writer.writeheader()
    writer.writerows(records)
