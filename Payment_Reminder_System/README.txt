Automatic Bill Payment Reminder System

This project implements an automated notification system that sends reminder emails to users whose bills are approaching their due date. The goal is to help users stay organized and avoid late payments by reminding them a few days in advance.



What the system does

1. Reads user and bill data from a `data.csv` file.
2. Calculates how many days remain until each bill’s due date.
3. Selects the bills that are due within the next 3 days.
4. Groups multiple bills under the same user.
5. Sends **one email per user**, containing all upcoming payments.
6. Updates the CSV file so that reminders are not sent twice.



CSV File Format (`data.csv`)

| Name | Category | Amount | Due Date | Email | Status |
|------|----------|--------|---------|-------|--------|

- Due date must follow the format: `dd/mm/yyyy`
- The **Status** column is automatically updated to `Notified` after email delivery




Email Sending Method

Emails are sent using the **Gmail SMTP server** over a secure **SSL** connection.

To use Gmail:
1. Enable **2-Step Verification** on your Google account
2. Generate an **App Password**
3. Use that password in the script instead of your real Gmail password


Technologies Used

| Library | Purpose |
|--------|---------|
| `csv` | Reading and writing user data |
| `datetime` | Calculating days until due date |
| `smtplib` + `ssl` | Secure email sending via SMTP |
| `email.message` | Creating formatted email messages |



Run the Program

Make sure you have Python 3 installed.
python main.py


